"""Deepgram STT backend: the livekit-plugins-deepgram streaming engine
behind the repo's custom STTClient protocol.

WhisperClient buffers audio and batch-transcribes on a VAD end; Deepgram is
streaming — the plugin's SpeechStream connects on creation and yields typed
SpeechEvents (START_OF_SPEECH / INTERIM_TRANSCRIPT / FINAL_TRANSCRIPT /
END_OF_SPEECH) as audio flows. This adapter drives that stream directly
(no AgentSession): frames in via ``push_frame``, events out through an
asyncio.Queue read by the session's ``push``.

Turn-taking: Deepgram's own endpointing (``endpointing_ms``) decides when an
utterance ends, replacing the energy-gate VAD WhisperClient used. The
session-level PTT/VAD frame gating in ``session.py`` is unchanged — it only
decides whether audio reaches STT at all.

Degradation contract mirrors whisper.py: a dead stream or auth failure is
surfaced once (logged, dashboard marked down), then every ``push`` returns
empty until a new client is created — the conversation keeps running.
"""

from __future__ import annotations

import asyncio
import contextlib
from typing import Any, Sequence

import livekit.rtc as rtc
from livekit.agents.stt import SpeechEventType

from ..config import Settings
from ..logging_config import get_logger
from .base import SpeechEvent, STTClient

logger = get_logger("clients.deepgram")

FLUSH_WAIT_S = 2.5  # how long flush() waits for the final after a PTT release


def _mark_deepgram(settings: Settings, status: str) -> None:
    try:
        from ..dashboard.hub import get_hub

        get_hub(settings).set_service("deepgram", status)
    except Exception:
        pass


class DeepgramClient:
    """Streaming Deepgram (Nova-3) STT backend implementing STTClient."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.endpoint_on_silence = settings.vad_enabled
        self.language_override: str | None = None
        self._stt: Any = None
        self._stream: Any = None
        self._queue: asyncio.Queue[SpeechEvent] = asyncio.Queue()
        self._reader: asyncio.Task | None = None
        self._fatal_error: str | None = None
        self._closed = False

    # -- STTClient API -------------------------------------------------------
    async def push(self, frame: rtc.AudioFrame) -> Sequence[SpeechEvent]:
        if self._closed or self._fatal_error:
            return []
        await self._ensure_stream()
        if self._stream is None:
            return []
        try:
            self._stream.push_frame(frame)
        except Exception as exc:
            self._fail(exc)
            return []
        return await self._drain()

    async def flush(self) -> Sequence[SpeechEvent]:
        if self._stream is None or self._fatal_error:
            return []
        try:
            self._stream.flush()
        except Exception as exc:
            self._fail(exc)
            return []
        # Deepgram finalizes after its endpointing silence; give it time to
        # land in the queue, then drain.
        await asyncio.sleep(FLUSH_WAIT_S)
        return await self._drain()

    async def aclose(self) -> None:
        if self._closed:
            return
        self._closed = True
        if self._reader is not None:
            self._reader.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await self._reader
            self._reader = None
        if self._stream is not None:
            with contextlib.suppress(Exception):
                await self._stream.aclose()
            self._stream = None

    # -- internals -----------------------------------------------------------
    async def _ensure_stream(self) -> None:
        if self._stream is not None or self._fatal_error:
            return
        try:
            # Construction MUST stay on the main thread: livekit's
            # Plugin.register_plugin rejects worker threads, and this worker
            # runs jobs on the main-thread event loop.
            self._build_stt()
            stream = self._stt.stream(language=self._effective_language())
            self._stream = stream
            self._queue = asyncio.Queue()
            self._reader = asyncio.create_task(self._read_loop(stream))
            _mark_deepgram(self.settings, "ok")
            logger.info(
                "deepgram stream opened",
                extra={"event": "stt.deepgram_open", "model": self.settings.deepgram_model, "language": self._effective_language()},
            )
        except Exception as exc:
            self._fail(exc)

    def _build_stt(self) -> None:
        from livekit.plugins import deepgram

        if self._stt is None:
            self._stt = deepgram.STT(
                api_key=self.settings.deepgram_api_key,
                model=self.settings.deepgram_model,
                language=self._effective_language(),
                interim_results=True,
                punctuate=True,
                endpointing_ms=self.settings.deepgram_endpointing_ms,
            )

    def _effective_language(self) -> str:
        return self.language_override or self.settings.deepgram_language

    async def _read_loop(self, stream: Any) -> None:
        try:
            async for event in stream:
                mapped = self._map_event(event)
                for speech in mapped:
                    await self._queue.put(speech)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            self._fail(exc)

    @staticmethod
    def _map_event(event: Any) -> list[SpeechEvent]:
        if event.type == SpeechEventType.START_OF_SPEECH:
            return [SpeechEvent(kind="started", text="")]
        if event.type in (SpeechEventType.RECOGNITION_USAGE, SpeechEventType.PREFLIGHT_TRANSCRIPT):
            return []
        if not event.alternatives:
            return []
        alt = event.alternatives[0]
        text = (alt.text or "").strip()
        if not _meaningful(text):
            return []
        if event.type == SpeechEventType.INTERIM_TRANSCRIPT:
            return [SpeechEvent(kind="partial", text=text, confidence=alt.confidence or None, language=alt.language)]
        if event.type == SpeechEventType.FINAL_TRANSCRIPT:
            return [SpeechEvent(kind="final", text=text, confidence=alt.confidence or None, language=alt.language)]
        return []

    def _fail(self, exc: Exception) -> None:
        if self._fatal_error is not None:
            return
        self._fatal_error = str(exc)
        _mark_deepgram(self.settings, "down")
        logger.error("deepgram stream failed", extra={"event": "stt.deepgram_failed", "error": str(exc)})

    async def _drain(self) -> list[SpeechEvent]:
        events: list[SpeechEvent] = []
        while not self._queue.empty():
            try:
                events.append(self._queue.get_nowait())
            except asyncio.QueueEmpty:
                break
        return events


def _meaningful(text: str) -> bool:
    """True when the transcript is real speech, not silence/noise junk."""
    return sum(1 for ch in text if ch.isalnum()) >= 2
