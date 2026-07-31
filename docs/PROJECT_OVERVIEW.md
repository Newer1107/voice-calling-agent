# Project Overview

A browser-based AI voice agent that runs the whole speech pipeline locally:
the browser streams audio through LiveKit to a Python agent, which transcribes
with Faster-Whisper, reasons with Ollama (OpenAI-compatible tool calling),
delegates business operations to n8n webhooks, and speaks back with Kokoro
TTS. Realtime state flows over the LiveKit data channel as typed events.

## Goals

- **Voice-first UX.** Talk to the agent from a browser tab: push-to-talk or
  voice-activity detection, streaming transcripts, and spoken replies.
- **Local-first speech.** STT, LLM, and TTS run on the local machine by
  default, so the voice loop works without cloud speech APIs and keeps audio
  local.
- **Business logic in n8n, nowhere else.** The agent is a thin conversational
  shell. Every real operation (bookings, orders, lookups, inventory, email)
  is an n8n webhook workflow; adding business capability means adding an n8n
  workflow, not agent code.
- **Replaceable components.** Each speech stage sits behind a small
  interface, so swapping STT, TTS, or the LLM is a bounded change.
- **Secrets only server-side.** The browser gets a short-lived JWT; it never
  sees LiveKit credentials or n8n URLs.

## Constraints

| Constraint | Why |
|---|---|
| No business logic in the agent | Keeps the agent generic and the business rules editable in n8n by non-developers |
| n8n reachable only via webhooks | The agent never calls the n8n API; `N8N_WEBHOOK_*` vars exist only on the agent side |
| Local-first speech | Default STT/LLM/TTS are local (Faster-Whisper, Ollama, Kokoro via `http://localhost`) |
| Browser knows no secrets | Only `NEXT_PUBLIC_*` values; token issuance happens in the agent's FastAPI helper |
| Typed realtime events | All data-channel messages follow `shared/schemas/events.schema.json`; unknown types are ignored |

## Tech stack

| Layer | Technology | Notes |
|---|---|---|
| Frontend | Next.js + LiveKit React SDK | Voice UI, data-channel events, transcripts, indicators |
| Realtime transport | LiveKit server | WebRTC media + signaling + data-channel relay |
| Agent worker | Python, LiveKit Agents framework | Conversation loop, session memory, event publishing |
| STT | Faster-Whisper | Model size / device / compute type via `STT_*` env |
| VAD | Silero | Endpointing; threshold and timing via `VAD_*` env |
| LLM | Ollama | OpenAI-compatible `/v1/chat/completions`; tool calling; `OLLAMA_*` env |
| TTS | Kokoro via local HTTP API | Voice, speed, timeout via `TTS_*` env |
| Business logic | n8n | Webhook workflows only; envelope contract in `shared/contracts/webhook.md` |
| HTTP helper | FastAPI | `POST /token`, `GET /health`, `GET /history/{session_id}` |
| Contracts | JSON Schema + markdown | `shared/` pins env names, events, and webhook shapes |

## Extension points

### Swap STT

Implement the `STTClient` protocol (transcribe audio, emit partials and
finals) and wire it in where the default Faster-Whisper client is created.
Nothing else changes: the agent loop, events, and frontend are
implementation-agnostic.

### Swap TTS

Implement the `TTSClient` protocol (synthesize text to audio). The default
client talks to Kokoro over `TTS_BASE_URL`; a different engine is a new
client class, same call site.

### Add a tool

Register the tool in `agent/src/voice_agent/tools/manager.py` (name,
description, argument JSON Schema, webhook path) and create the matching n8n
webhook workflow. The LLM discovers the tool from the registry; no other code
changes. Full recipe: [WEBHOOKS.md](WEBHOOKS.md#adding-a-new-tool).

### Swap the LLM provider

Any OpenAI-compatible endpoint can replace Ollama via `OLLAMA_BASE_URL` and
`OLLAMA_MODEL` (and optionally a system prompt override with
`OLLAMA_SYSTEM_PROMPT`). Tool calling must be supported for tools to keep
working.

## Repo layout

| Path | Contents |
|---|---|
| `frontend/` | Next.js + LiveKit React SDK voice UI |
| `agent/` | Python agent worker (STT/LLM/TTS/tool layers) + FastAPI helper |
| `shared/` | Cross-module contracts: env names, event schema, webhook contract |
| `docs/` | Architecture, API, webhook, and overview documentation |
| `.env.example` | Aggregated environment template (agent + frontend sections) |

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) - pipeline, responsibilities, session lifecycle
- [API.md](API.md) - HTTP surface and data-channel event reference
- [WEBHOOKS.md](WEBHOOKS.md) - n8n integration, example payloads, add-a-tool
- `shared/` - the source-of-truth contracts
