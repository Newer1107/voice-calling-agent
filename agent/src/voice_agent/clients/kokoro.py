"""Kokoro TTS backend.

Assumed contract (documented in README): ``POST {TTS_BASE_URL}/tts`` with
JSON ``{"text": str, "voice": str, "speed": float}`` returns ``200`` with an
``audio/wav`` body (16-bit PCM). :func:`decode_wav` parses that body —
standard 44-byte WAV headers are parsed manually, and bare PCM16 falls back
to a 24 kHz guess, keeping the decode dependency-free.

Degradation: a failed synthesis returns an empty byte string (session then
publishes ``tts_failed`` and continues text-only) — it never raises.
"""

from __future__ import annotations

import asyncio
import struct
from typing import Any

import httpx
import numpy as np

from ..config import Settings
from ..logging_config import get_logger

logger = get_logger("clients.kokoro")

TTS_TIMEOUT_CEIL_S = 60.0
DEFAULT_VOICE = "af_heart"
DEFAULT_SPEED = 1.0
WAV_HEADER_MIN = 44


def decode_wav(data: bytes) -> tuple[bytes, int, int]:
    """Parse a WAV body into (pcm16 bytes, sample rate, channels).

    Handles standard 44-byte WAV headers; anything unparseable is treated
    as bare PCM16 at 24 kHz (Kokoro's native rate).
    """
    if len(data) >= WAV_HEADER_MIN and data[:4] == b"RIFF" and data[8:12] == b"WAVE":
        try:
            fmt = _find_chunk(data, b"fmt ")
            data_chunk = _find_chunk(data, b"data")
            if fmt is not None and data_chunk is not None:
                fmt_offset, fmt_bytes = fmt
                data_offset, data_bytes = data_chunk
                audio_format, channels, sample_rate = struct.unpack_from("<HHI", fmt_bytes, 0)
                if audio_format == 1:  # PCM16
                    return data[data_offset : data_offset + len(data_bytes)], sample_rate, channels
                if audio_format == 3:  # IEEE float -> convert to PCM16
                    floats = np.frombuffer(data_bytes, dtype=np.float32)
                    pcm = np.clip(floats * 32767.0, -32768.0, 32767.0).astype(np.int16).tobytes()
                    return pcm, sample_rate, channels
        except (struct.error, IndexError):
            pass
    return data, 24000, 1


def _find_chunk(data: bytes, chunk_id: bytes) -> tuple[int, bytes] | None:
    offset = 12
    while offset + 8 <= len(data):
        if data[offset : offset + 4] == chunk_id:
            size = struct.unpack_from("<I", data, offset + 4)[0]
            start = offset + 8
            return start, data[start : start + size]
        size = struct.unpack_from("<I", data, offset + 4)[0]
        offset += 8 + size + (size % 2)
    return None


class KokoroClient:
    """TTS via the assumed Kokoro HTTP contract."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._client = httpx.AsyncClient(
            base_url=settings.tts_base_url.rstrip("/"),
            timeout=httpx.Timeout(min(settings.tts_timeout_ms / 1000.0, TTS_TIMEOUT_CEIL_S)),
        )

    async def synthesize(self, text: str, *, voice: str | None = None) -> bytes:
        """Synthesize speech; returns b'' (not raises) on any failure."""
        try:
            response = await self._client.post(
                "/tts",
                json={"text": text, "voice": voice or self.settings.tts_voice or DEFAULT_VOICE, "speed": self.settings.tts_speed},
            )
            if response.status_code != 200:
                logger.warning("tts http error", extra={"event": "tts.http_error", "status": response.status_code})
                return b""
            return response.content
        except (httpx.TimeoutException, httpx.HTTPError) as exc:
            logger.warning("tts request failed", extra={"event": "tts.failed", "error": str(exc)})
            return b""

    async def aclose(self) -> None:
        await self._client.aclose()
