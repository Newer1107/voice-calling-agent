# voice-agent

Python LiveKit voice agent for the browser-based AI voice assistant.

Pipeline: browser mic → LiveKit → agent → Deepgram Nova-3 STT (streaming) →
Ollama LLM (tool calling, llama3.1:8b) → PostgreSQL gym database (tools) →
LLM response → Edge TTS (Kokoro fallback, local HTTP API) → streamed audio
back to the browser via LiveKit. Realtime state (transcripts, indicators,
tool activity) streams to the browser over the LiveKit data channel
(envelope in `shared/schemas/events.schema.json`).

## Quick start

```bash
cd agent
pip install -e .
cp .env.example .env      # fill in real values (see comments)
python -m voice_agent.main
```

Requirements: Python >= 3.12, a LiveKit server, Ollama serving
`OLLAMA_MODEL`, a Deepgram API key (`STT_PROVIDER=deepgram`) or local
Faster-Whisper (`STT_PROVIDER=whisper`), PostgreSQL for the gym tools and
dashboard, and a local Kokoro HTTP wrapper (see below). The worker joins a
room and serves one participant per job; the FastAPI helper (token issuance,
history, health) runs in the same process when `ENABLE_AGENT_API=true`
(default).

Note: `OLLAMA_BASE_URL` may be a LAN address like `http://192.168.x.x:11434`
(not always `localhost`) when Ollama runs on a separate machine on the
network.

## Architecture

See `docs/ARCHITECTURE.md` for the full flow diagram. Module map:

```
src/voice_agent/
├── main.py          worker entrypoint (LiveKit) + uvicorn task for the helper API
├── config.py        pydantic-settings; env names per shared/configuration/env-conventions.md
├── logging_config.py structured json/text logging factory
├── events.py        LiveKit data-channel publisher (events.schema.json)
├── api/             FastAPI: POST /token, GET /health, GET /history/{session_id}
├── services/        conversation history (SESSION_HISTORY_LIMIT, tool records) + one session's pipeline orchestration
├── clients/         STT/LLM/TTS protocols + WhisperClient / DeepgramClient / OllamaClient / KokoroClient
├── dashboard/       event hub + DashboardDB (conversations) + GymDB (members, memberships,
│                    bookings, products, orders, plans, staff requests)
└── tools/           Tool registry + DB-backed GymTool (11 tools over GymDB)
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

## STT providers

- `STT_PROVIDER=deepgram` (default) — Deepgram Nova-3, cloud streaming,
  `DEEPGRAM_LANGUAGE=en-IN` (Indian English), `DEEPGRAM_ENDPOINTING_MS=700`
  is the turn-taking source of truth. Requires `DEEPGRAM_API_KEY`. The plugin
  is imported on the main thread at worker start (`Plugin.register_plugin`
  rejects worker threads).
- `STT_PROVIDER=whisper` — local Faster-Whisper (medium, int8), energy-gate
  endpointing + faster-whisper's built-in silero `vad_filter` on final passes.

## STT benchmark

`scripts/bench_stt.py` measures WER (jiwer) and end-to-end latency for any
provider: phrases → Kokoro TTS → LiveKit → `transcript.final` → jiwer.

```bash
.venv/bin/python scripts/bench_stt.py <label>   # e.g. whisper-baseline, deepgram-nova3
# results -> benchmark/results/<label>.json (avg WER + avg latency ms)
```

Reference numbers (same 10 phrases, same harness):
Faster-Whisper medium/int8 ~ 5.6 s latency, WER 0.648; Deepgram Nova-3
en-IN ~ 0.6 s latency, WER 0.202.

## Notes

- Data-channel messages are published on the room's default channel (no
  topic), so any `data_received` listener receives them.
- The worker runs with `num_idle_processes=1` so the in-process FastAPI task
  is a single instance (no port conflicts).
- `WorkerOptions` accepts either `entrypoint` (livekit-agents >= 1.0) or
  `entrypoint_fnc` (0.x) — resolved at runtime.
- Payments and upgrades are human-in-the-loop: `upgradeMembership` and
  `renewMembership` insert a `staff_requests` row (status `pending`) and the
  agent tells the member the front desk will confirm — the tier is never
  changed by the AI, and the tool layer rejects fabricated/placeholder member
  names so the conversation never acts on a made-up identity.
