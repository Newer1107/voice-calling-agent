"""faster-whisper STT backend.

Audio flows into a background thread where faster-whisper's built-in silero
``vad_filter`` runs on every transcription pass, so ``final`` events carry
model-verified endpoints — the energy gate in the VAD layer only decides
when to *attempt* a transcription. Transcriptions run with
``audio_buffer=None`` (no cache) to keep the energy-gate cadence.

Degradation contract: if the model cannot load or a pass fails, an
``stt_failed`` event is published and the session keeps running (speech is
simply not recognized for that pass).
"""

from __future__ import annotations

import asyncio
from typing import Any, Sequence

import livekit.rtc as rtc

from ..config import Settings
from ..logging_config import get_logger
from .base import SpeechEvent, STTClient, VADConfig, VADEndpointDetector

logger = get_logger("clients.whisper")

RECOGNIZE_TIMEOUT_S = 20.0
PARTIAL_INTERVAL_MS = 2000  # partial transcription cadence while speech is ongoing
MAX_BUFFER_S = 30.0         # cap: force a final past this much continuous speech
# Domain vocabulary bias for short utterances — improves word accuracy on
# gym-specific terms ("gym plans" instead of "jump lands").
_INITIAL_PROMPT = (
    "gym, membership, plans, class, yoga, sauna, massage, book, booking, "
    "upgrade, personal training, order, inventory, session, Sarah, Ravi, "
    "IronPeak, receptionist"
)


class WhisperClient:
    """Whisper STT backend with energy-gate endpointing."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.endpoint_on_silence = settings.vad_enabled
        self.language_override: str | None = None
        self.vad = VADEndpointDetector(
            VADConfig(
                threshold=settings.vad_threshold,
                min_speech_ms=settings.vad_min_speech_ms,
                min_silence_ms=settings.vad_min_silence_ms,
                sample_rate=16000,
            )
        )
        self._closed = False
        self._audio_buffer = bytearray()
        self._buffer_ms = 0
        self._last_partial_ms = 0
        self._model: Any = None
        self._model_error: str | None = None
        self._model_loading = False

    # -- STTClient API -------------------------------------------------------
    async def push(self, frame: rtc.AudioFrame) -> Sequence[SpeechEvent]:
        """Energy-gate the frame; emit partials while speaking and a final on endpoint."""
        events: list[SpeechEvent] = []
        vad_events = self.vad.push(frame)
        if self._model is None and self._model_error is None:
            await self._ensure_model_loaded()
        if "started" in vad_events:
            self._audio_buffer.clear()
            self._buffer_ms = 0
            self._last_partial_ms = 0
        data = frame.data if isinstance(frame.data, (bytes, bytearray)) else bytes(frame.data)
        self._audio_buffer.extend(data)
        self._buffer_ms += int(1000.0 * frame.samples_per_channel / float(frame.sample_rate or 1))
        if "ended" in vad_events:
            events.extend(await self._transcribe())
            return events
        if not self.vad.speech_active:
            return events
        if self._buffer_ms - self._last_partial_ms >= PARTIAL_INTERVAL_MS:
            self._last_partial_ms = self._buffer_ms
            events.extend(await self._transcribe(clear=False, partial=True))
        if self._buffer_ms >= MAX_BUFFER_S * 1000:
            events.extend(await self._transcribe())
            self.vad.reset()
        return events

    async def _transcribe(self, *, clear: bool = True, partial: bool = False) -> list[SpeechEvent]:
        """Run one transcription pass off the event loop."""
        buffer = bytes(self._audio_buffer)
        if clear:
            self._audio_buffer.clear()
            self._buffer_ms = 0
        if not buffer or self._model is None:
            if self._model is None:
                logger.warning("stt unavailable", extra={"event": "stt_unavailable", "error": self._model_error or "unknown"})
            return []
        result = await asyncio.to_thread(self._recognize, buffer)
        if not result:
            return []
        if partial:
            return [SpeechEvent(kind="partial", text=result[0].text, language=result[0].language, confidence=result[0].confidence)]
        return result

    async def flush(self) -> Sequence[SpeechEvent]:
        """PTT release: transcribe whatever audio remains (best effort)."""
        buffer: bytes = bytes(self._audio_buffer)
        self._audio_buffer.clear()
        self._buffer_ms = 0
        if not buffer or self._model is None:
            return []
        return await asyncio.to_thread(self._recognize, buffer)

    async def aclose(self) -> None:
        self._closed = True
        self._audio_buffer.clear()

    # -- internals -----------------------------------------------------------
    async def _ensure_model_loaded(self) -> None:
        """Load faster-whisper lazily off the event loop (happens once)."""
        if self._model is not None or self._model_error is not None or self._model_loading:
            return
        self._model_loading = True
        try:
            await asyncio.to_thread(self._load_model)
        finally:
            self._model_loading = False

    def _load_model(self) -> None:
        """Blocking model construction; runs in a worker thread."""
        try:
            from faster_whisper import WhisperModel

            self._model = WhisperModel(
                self.settings.stt_model_size,
                device=self.settings.stt_device,
                compute_type=self.settings.stt_compute_type,
            )
            logger.info("whisper model loaded", extra={"event": "stt.model_loaded", "model": self.settings.stt_model_size})
        except Exception as exc:
            self._model_error = str(exc)
            logger.error("whisper model load failed", extra={"event": "stt.model_failed", "error": str(exc)})

    def _recognize(self, pcm16: bytes) -> list[SpeechEvent]:
        """Run one transcription pass inside the STT thread (blocking)."""
        import numpy as np

        try:
            samples = np.frombuffer(pcm16, dtype=np.int16).astype(np.float32) / 32768.0
            if samples.size < self.settings.vad_min_speech_ms * 16:
                return []
            segments_iter, info = self._model.transcribe(
                samples,
                language=self.language_override or self.settings.stt_language,
                vad_filter=self.endpoint_on_silence,  # silero pass for real endpoints
                vad_parameters={"min_silence_duration_ms": self.settings.vad_min_silence_ms},
                initial_prompt=_INITIAL_PROMPT,
            )
            text_parts: list[str] = []
            for segment in segments_iter:
                text_parts.append(segment.text)
                if len(text_parts) >= 200:
                    break
            text = "".join(text_parts).strip()
            if not text:
                return []
            return [SpeechEvent(kind="final", text=text, language=info.language, confidence=getattr(info, "language_probability", None))]
        except Exception as exc:
            logger.warning("transcription pass failed", extra={"event": "stt.failed", "error": str(exc)})
            return []
