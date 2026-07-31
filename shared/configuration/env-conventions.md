# Environment Variable Conventions

Canonical names shared by `frontend/` and `agent/`. Each module has its own `.env.example`;
this file is the source of truth for names and defaults.

## agent/ (Python)

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `LIVEKIT_URL` | yes | — | LiveKit Cloud URL (e.g. `wss://<project>.livekit.cloud`) |
| `LIVEKIT_API_KEY` | yes | — | LiveKit API key (server-side, signs tokens) |
| `LIVEKIT_API_SECRET` | yes | — | LiveKit API secret (server-side) |
| `LIVEKIT_WORKER_NAME` | no | `voice-agent` | Worker identity shown in LiveKit dashboard |
| `OLLAMA_BASE_URL` | yes | `http://localhost:11434` | Ollama server root (OpenAI-compatible path used: `{base}/v1/chat/completions`) |
| `OLLAMA_MODEL` | yes | — | Model id, e.g. `llama3.1` |
| `OLLAMA_TEMPERATURE` | no | `0.7` | LLM sampling temperature |
| `OLLAMA_TIMEOUT_MS` | no | `30000` | LLM request timeout |
| `OLLAMA_MAX_RETRIES` | no | `2` | Retries on transient LLM failures |
| `OLLAMA_MAX_TOKENS` | no | `512` | Max completion tokens (keeps voice latency sane) |
| `OLLAMA_SYSTEM_PROMPT` | no | — | Override the default system prompt (see `agent/src/voice_agent/clients/prompts.py`) |
| `STT_MODEL_SIZE` | no | `base` | Faster-Whisper model size (`tiny`…`large-v3`) |
| `STT_DEVICE` | no | `auto` | `auto`/`cpu`/`cuda` |
| `STT_COMPUTE_TYPE` | no | `auto` | `auto`/`int8`/`float16`/`float32` |
| `STT_LANGUAGE` | no | — | Optional language code to force (e.g. `en`); auto-detect when unset |
| `VAD_ENABLED` | no | `true` | Enable voice-activity detection for endpointing |
| `VAD_THRESHOLD` | no | `0.5` | Silero VAD speech probability threshold |
| `VAD_MIN_SPEECH_MS` | no | `250` | Min speech duration before a segment is transcribed |
| `VAD_MIN_SILENCE_MS` | no | `700` | Silence duration that ends a segment |
| `TTS_BASE_URL` | no | `http://localhost:8880` | Kokoro local API base (see `contracts/kokoro` notes in module README) |
| `TTS_VOICE` | no | `af_heart` | Kokoro voice id |
| `TTS_SPEED` | no | `1.0` | Speech rate multiplier |
| `TTS_TIMEOUT_MS` | no | `15000` | Synthesis request timeout |
| `N8N_WEBHOOK_BASE_URL` | yes | — | Base URL for n8n webhooks, e.g. `https://n8n.example.com/webhook` |
| `N8N_WEBHOOK_TIMEOUT_MS` | no | `10000` | Per-tool webhook timeout |
| `N8N_WEBHOOK_MAX_RETRIES` | no | `1` | Retries for transient webhook failures (5xx/network) |
| `AGENT_HOST` | no | `0.0.0.0` | FastAPI bind host |
| `AGENT_PORT` | no | `8080` | FastAPI bind port |
| `AGENT_LOG_LEVEL` | no | `INFO` | `DEBUG`/`INFO`/`WARNING`/`ERROR` |
| `AGENT_LOG_FORMAT` | no | `json` | `json` or `text` |
| `SESSION_HISTORY_LIMIT` | no | `50` | Max messages kept in conversation memory per session |
| `ENABLE_AGENT_API` | no | `true` | Run the FastAPI helper (token issuance, history, health) |

## frontend/ (Next.js)

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_LIVEKIT_URL` | yes | — | LiveKit Cloud URL the browser connects to (public), e.g. `wss://<project>.livekit.cloud` |
| `NEXT_PUBLIC_AGENT_API_URL` | yes | — | Agent FastAPI base (token + history), e.g. `http://192.168.x.x:8080` |
| `NEXT_PUBLIC_AGENT_NAME` | no | `Voice Agent` | Display name of the agent participant |

## Shared conventions

- Secrets (LiveKit key/secret) live **only** in `agent/.env`. The browser never receives
  them — it gets a short-lived JWT from `POST /token`.
- All timeouts/retries are configurable via env, never hardcoded.
- `N8N_WEBHOOK_*` vars exist only on the agent side; the frontend has no n8n knowledge.
- **Whisper runs in-process on the Home Server** (Faster-Whisper via the
  `STT_*` vars above) — there is deliberately **no `WHISPER_BASE_URL`** and no
  separate Whisper service. If you later want a remote Whisper service, add it
  behind the agent's `STTClient` protocol (`agent/src/voice_agent/clients/base.py`)
  and add the env var then; the rest of the pipeline is unaffected.
