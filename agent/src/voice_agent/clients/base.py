"""Client protocols and shared types for the STT / LLM / TTS backends.

Merged from the former per-domain ``client.py`` modules: backends are
injected, so swapping one never touches the session code.

- STT: :class:`STTClient` protocol plus the shared VAD endpoint-detector
  layer. The endpoint detector turns per-frame STT output (which the STT
  engine produces on its own cadence) into ``partial``/``final``
  SpeechEvents using a simple energy gate. It lives here so every STT
  backend gets identical endpointing behavior.
- LLM: :class:`LLMClient` protocol and stream event types. Sessions consume
  :meth:`LLMClient.stream` (deltas + tool calls) and fall back to
  :meth:`LLMClient.complete` (with retries) when streaming fails.
  :class:`LLMError` carries ``retryable`` so the session can decide whether
  to fall back or fail the turn.
- TTS: :class:`TTSClient` protocol. Backends are injected; sessions only
  ever call :meth:`synthesize` and receive raw audio bytes (the session
  handles decoding and resampling via
  :func:`voice_agent.clients.kokoro.decode_wav`).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Protocol, Sequence, runtime_checkable

import livekit.rtc as rtc
import numpy as np


@dataclass
class VADConfig:
    """Tunables for the energy-gate endpoint detector."""

    threshold: float = 0.5
    min_speech_ms: int = 250
    min_silence_ms: int = 700
    sample_rate: int = 16000


def _rms(frame: rtc.AudioFrame) -> float:
    data = frame.data if isinstance(frame.data, (bytes, bytearray)) else bytes(frame.data)
    samples = np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0
    if samples.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(samples**2)))


class VADEndpointDetector:
    """Energy-gate VAD: emits ``started``/``speech``/``ended`` VAD events.

    Call :meth:`push` with each 16 kHz mono frame and inspect the returned
    VAD events. Speech text itself comes from the STT engine — this layer
    only decides when a speech segment begins and ends.
    """

    def __init__(self, config: VADConfig) -> None:
        self.config = config
        self.speech_active = False
        self._speech_ms = 0
        self._silence_ms = 0

    def _reset(self) -> None:
        self.speech_active = False
        self._speech_ms = 0
        self._silence_ms = 0

    def push(self, frame: rtc.AudioFrame) -> list[str]:
        duration_ms = 1000.0 * frame.samples_per_channel / float(frame.sample_rate or 1)
        events: list[str] = []
        # VAD_THRESHOLD is a 0-1 sensitivity knob (Silero-style scale, default
        # 0.5). RMS of real speech is ~0.02-0.15, so map the knob to an RMS
        # gate: 0.5 -> ~0.012, higher threshold = less sensitive (higher gate).
        rms_gate = 0.002 + 0.02 * self.config.threshold
        if _rms(frame) >= rms_gate:
            if not self.speech_active:
                self.speech_active = True
                events.append("started")
            self._speech_ms += duration_ms
            self._silence_ms = 0
        else:
            if self.speech_active:
                self._silence_ms += duration_ms
                if self._silence_ms >= self.config.min_silence_ms:
                    self.speech_active = False
                    events.append("ended")
            self._speech_ms = 0 if not self.speech_active else self._speech_ms
        return events

    def reset(self) -> None:
        self._reset()


@dataclass
class SpeechEvent:
    """One piece of recognized speech.

    ``kind == "partial"`` events stream live text; ``kind == "final"``
    closes a segment and must carry the full text.
    """

    kind: str  # "partial" | "final"
    text: str
    confidence: float | None = None
    language: str | None = None


@runtime_checkable
class STTClient(Protocol):
    """Protocol for STT backends used by the session pipeline.

    Backends push frames into the shared :class:`VADEndpointDetector` and
    return per-frame SpeechEvents.
    """

    #: Whether the engine detects speech endpoints (true) or we rely on
    #: manual PTT (false). The session reads this to decide event cadence.
    endpoint_on_silence: bool

    #: Overrides the configured STT language; None keeps the default.
    language_override: str | None

    async def push(self, frame: rtc.AudioFrame) -> Sequence[SpeechEvent]:
        """Feed one audio frame; return speech events produced so far.

        Async because backends transcribe off the event loop
        (``asyncio.to_thread``); the session awaits every push.
        """
        ...

    async def flush(self) -> Sequence[SpeechEvent]:
        """Force-close the current segment (PTT release)."""
        ...

    async def aclose(self) -> None:
        """Release backend resources (idempotent)."""
        ...


class LLMError(Exception):
    """A failure from the LLM backend.

    ``retryable=True`` means a retry or completion fallback may succeed
    (network, timeout, 5xx, rate-limit); ``retryable=False`` means the
    request itself was rejected (4xx, schema errors).
    """

    def __init__(self, message: str, *, retryable: bool = True) -> None:
        super().__init__(message)
        self.retryable = retryable


@dataclass(frozen=True)
class ToolCall:
    """A tool invocation requested by the model."""

    id: str
    name: str
    arguments: dict[str, Any]
    arguments_parse_error: str | None = None


@dataclass(frozen=True)
class LLMTextDelta:
    """A chunk of streamed assistant text."""

    text: str


@dataclass(frozen=True)
class LLMToolCalls:
    """The tool calls attached to the (possibly empty) completion."""

    tool_calls: list[ToolCall]


LLMStreamEvent = LLMTextDelta | LLMToolCalls


@dataclass
class LLMResponse:
    """Non-streaming completion result."""

    content: str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)


@runtime_checkable
class LLMClient(Protocol):
    """Protocol for LLM backends (e.g. OllamaClient)."""

    async def stream(
        self,
        history: list[dict[str, Any]],
        *,
        tools: list[dict[str, Any]] | None = None,
    ) -> AsyncIterator[LLMStreamEvent]:
        """Stream a completion. Tool calls may arrive with the final chunk."""
        ...
        if False:
            yield LLMTextDelta("")  # pragma: no cover

    async def complete(
        self,
        history: list[dict[str, Any]],
        *,
        tools: list[dict[str, Any]] | None = None,
    ) -> LLMResponse:
        """One non-streaming completion, with built-in retries."""
        ...

    async def aclose(self) -> None:
        """Release backend resources (idempotent)."""
        ...


@runtime_checkable
class TTSClient(Protocol):
    """Protocol for text-to-speech backends."""

    async def synthesize(self, text: str) -> bytes:
        """Synthesize speech; return raw audio bytes (typically WAV)."""
        ...

    async def aclose(self) -> None:
        """Release backend resources (idempotent)."""
        ...
