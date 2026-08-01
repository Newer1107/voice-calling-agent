"""Application settings loaded from environment variables.

Field names map 1:1 to the variable names in ``shared/env-conventions.md``
(the canonical source of truth). ``AGENT_CORS_ORIGINS`` is the single
addition beyond that file (needed for the configurable CORS requirement) and
is documented on the field.
"""

from __future__ import annotations

from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration for the voice agent worker.

    Values come from environment variables / ``agent/.env``.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # --- LiveKit -------------------------------------------------------------
    livekit_url: str = Field(description="LiveKit server URL, e.g. wss://livekit.example.com")
    livekit_api_key: str = Field(description="LiveKit API key (server-side, signs JWTs)")
    livekit_api_secret: str = Field(description="LiveKit API secret (server-side)")
    livekit_worker_name: str = Field(default="voice-agent", description="Worker identity shown in the LiveKit dashboard")

    # --- Ollama LLM ----------------------------------------------------------
    ollama_base_url: str = Field(default="http://localhost:11434")
    ollama_model: str = Field(description="Ollama model id, e.g. llama3.1")
    ollama_temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    ollama_timeout_ms: int = Field(default=30000, ge=1)
    ollama_max_retries: int = Field(default=2, ge=0)
    ollama_max_tokens: int = Field(default=200, ge=1, description="Max tokens per reply; keeps spoken answers short")
    ollama_system_prompt: str | None = Field(default=None, description="Overrides the default prompt in clients/prompts.py")

    # --- Faster-Whisper STT --------------------------------------------------
    stt_provider: Literal["whisper", "deepgram"] = Field(
        default="whisper",
        description="STT backend: 'whisper' (local faster-whisper) or 'deepgram' (cloud Nova-3 streaming)",
    )
    stt_model_size: str = Field(default="base")
    stt_device: str = Field(default="auto", description="auto | cpu | cuda")
    stt_compute_type: str = Field(default="auto", description="auto | int8 | float16 | float32")
    stt_language: str | None = Field(default=None, description="Force a language code; auto-detect when unset")

    # --- Deepgram STT (used when stt_provider=deepgram) ----------------------
    deepgram_api_key: str | None = Field(
        default=None,
        description="Deepgram API key (required when stt_provider=deepgram)",
    )
    deepgram_model: str = Field(default="nova-3", description="Deepgram model id, e.g. nova-3")
    deepgram_language: str = Field(
        default="en-IN",
        description="Deepgram language tag; en-IN = Indian English (Nova-3 supports it)",
    )
    deepgram_endpointing_ms: int = Field(
        default=700,
        ge=0,
        description="Silence (ms) after which Deepgram finalizes an utterance; 0 disables its endpointing",
    )

    # --- VAD / endpointing ---------------------------------------------------
    vad_enabled: bool = Field(default=True)
    vad_threshold: float = Field(default=0.5, ge=0.0, le=1.0)
    vad_min_speech_ms: int = Field(default=250, ge=0)
    vad_min_silence_ms: int = Field(default=700, ge=0)

    # --- Kokoro TTS ----------------------------------------------------------
    tts_base_url: str = Field(default="http://localhost:8880")
    tts_voice: str = Field(default="af_heart")
    tts_speed: float = Field(default=1.0, gt=0.0)
    tts_timeout_ms: int = Field(default=15000, ge=1)

    # --- n8n webhook tools ---------------------------------------------------
    n8n_webhook_base_url: str = Field(description="Base URL for n8n webhooks, e.g. https://n8n.example.com/webhook")
    n8n_webhook_timeout_ms: int = Field(default=10000, ge=1)
    n8n_webhook_max_retries: int = Field(default=1, ge=0)

    # --- Agent HTTP helper API ----------------------------------------------
    agent_host: str = Field(default="0.0.0.0")
    agent_port: int = Field(default=8080, ge=1, le=65535)
    enable_agent_api: bool = Field(default=True)
    # Beyond shared/env-conventions.md: comma-separated CORS allow-list for the
    # FastAPI helper (the frontend dev server is not same-origin with the agent).
    agent_cors_origins: str = Field(default="http://localhost:3000")

    # --- Logging & conversation ---------------------------------------------
    agent_log_level: str = Field(default="INFO")
    agent_log_format: Literal["json", "text"] = Field(default="json")
    session_history_limit: int = Field(default=50, ge=1)

    # --- Dashboard (realtime business console) ------------------------------
    enable_dashboard: bool = Field(default=True, description="Serve /dashboard/* and /ws/dashboard")
    dashboard_database_url: str = Field(
        default="postgresql://postgres:postgres@127.0.0.1:5432/voice_dashboard",
        description="PostgreSQL DSN for dashboard + gym persistence (asyncpg)",
    )

    # --- Computed helpers ----------------------------------------------------
    @property
    def ollama_timeout(self) -> float:
        """LLM request timeout in seconds."""
        return self.ollama_timeout_ms / 1000.0

    @property
    def tts_timeout(self) -> float:
        """TTS request timeout in seconds."""
        return self.tts_timeout_ms / 1000.0

    @property
    def n8n_webhook_timeout(self) -> float:
        """Per-tool webhook timeout in seconds."""
        return self.n8n_webhook_timeout_ms / 1000.0

    @property
    def cors_origins(self) -> list[str]:
        """CORS allow-list parsed from AGENT_CORS_ORIGINS (comma separated)."""
        return [origin.strip() for origin in self.agent_cors_origins.split(",") if origin.strip()]
