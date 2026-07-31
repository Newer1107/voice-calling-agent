# voice-agent

Python LiveKit voice agent for the browser-based AI voice assistant.

Pipeline: browser mic â†’ LiveKit â†’ agent â†’ Faster-Whisper STT â†’ Ollama LLM
(tool calling) â†’ n8n webhooks (tools) â†’ LLM response â†’ Kokoro TTS (local HTTP
API) â†’ streamed audio back to the browser via LiveKit. Realtime state
(transcripts, indicators, tool activity) streams to the browser over the
LiveKit data channel (envelope in `shared/schemas/events.schema.json`).

## Quick start

```bash
cd agent
pip install -e .
cp .env.example .env      # fill in real values (see comments)
python -m voice_agent.main
```

Requirements: Python >= 3.12, a LiveKit server, Ollama serving
`OLLAMA_MODEL`, an n8n instance exposing the tool webhooks, and a local
Kokoro HTTP wrapper (see below). The worker joins a room and serves one
participant per job; the FastAPI helper (token issuance, history, health)
runs in the same process when `ENABLE_AGENT_API=true` (default).

Note: `OLLAMA_BASE_URL` may be a LAN address like `http://192.168.x.x:11434`
(not always `localhost`) when Ollama runs on a separate machine on the
network.

## Architecture

See `docs/ARCHITECTURE.md` for the full flow diagram. Module map:

```
src/voice_agent/
â”œâ”€â”€ main.py          worker entrypoint (LiveKit) + uvicorn task for the helper API
â”œâ”€â”€ config.py        pydantic-settings; env names per shared/configuration/env-conventions.md
â”œâ”€â”€ logging_config.py structured json/text logging factory
â”œâ”€â”€ events.py        LiveKit data-channel publisher (events.schema.json)
â”œâ”€â”€ api/             FastAPI: POST /token, GET /health, GET /history/{session_id}
â”œâ”€â”€ services/        conversation history (SESSION_HISTORY_LIMIT, tool records) + one session's pipeline orchestration
â”œâ”€â”€ clients/         STT/LLM/TTS protocols + WhisperClient / OllamaClient / KokoroClient + N8NClient webhook client
â””â”€â”€ tools/           Tool registry + WebhookTool (n8n contract per webhook.md)
```

Each layer depends on a Protocol (`STTClient`, `LLMClient`, `TTSClient`,
`ToolManager`) and degrades gracefully: a failed STT chunk, LLM timeout, TTS
failure or invalid tool response publishes an `error` event (codes
`stt_failed` / `llm_failed` / `tts_failed` / `tool_failed` / `internal`) and
the conversation continues; only participant disconnect ends a session.

## Assumed Kokoro endpoint contract

```
POST {TTS_BASE_URL}/tts
Content-Type: application/json

{"text": "Hello world", "voice": "af_heart", "speed": 1.0}

200 OK, Content-Type: audio/wav
Body: complete WAV file, 16-bit PCM, mono or stereo, any sample rate
      (the agent resamples everything to 24 kHz mono for playback)
```

`TTS_VOICE` / `TTS_SPEED` come from the environment; anything that is not a
16-bit PCM WAV is treated as a TTS failure (`tts_failed` event) and the reply
is delivered text-only.

## Notes

- Data-channel messages are published on the room's default channel (no
  topic), so any `data_received` listener receives them.
- The worker runs with `num_idle_processes=1` so the in-process FastAPI task
  is a single instance (no port conflicts).
- `WorkerOptions` accepts either `entrypoint` (livekit-agents >= 1.0) or
  `entrypoint_fnc` (0.x) â€” resolved at runtime.
- Endpointing uses a cheap energy gate to drive partials/finals plus
  faster-whisper's built-in silero `vad_filter` on final passes; no extra VAD
  dependency is installed.
