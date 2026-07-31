"""Backend clients for STT / LLM / TTS plus the n8n webhook HTTP client.

Protocols and shared types live in :mod:`voice_agent.clients.base`;
concrete backends (``OllamaClient``, ``WhisperClient``, ``KokoroClient``)
and the ``N8NClient`` webhook client are siblings here.
"""

from .base import (
    LLMClient,
    LLMError,
    LLMResponse,
    LLMStreamEvent,
    LLMTextDelta,
    LLMToolCalls,
    SpeechEvent,
    STTClient,
    ToolCall,
    TTSClient,
    VADConfig,
    VADEndpointDetector,
)
from .kokoro import KokoroClient, decode_wav
from .n8n import N8NClient, WebhookToolError
from .ollama import OllamaClient
from .prompts import build_system_prompt
from .whisper import WhisperClient

__all__ = [
    "LLMClient",
    "LLMError",
    "LLMResponse",
    "LLMStreamEvent",
    "LLMTextDelta",
    "LLMToolCalls",
    "SpeechEvent",
    "STTClient",
    "ToolCall",
    "TTSClient",
    "VADConfig",
    "VADEndpointDetector",
    "KokoroClient",
    "decode_wav",
    "N8NClient",
    "WebhookToolError",
    "OllamaClient",
    "build_system_prompt",
    "WhisperClient",
]
