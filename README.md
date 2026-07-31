# AI Voice Agent

A realtime voice assistant that runs in the browser: you talk, a Python agent
transcribes locally, reasons with Ollama, delegates business operations to n8n
webhooks, and speaks back — all streamed over LiveKit.

```
Browser → Next.js (VPS) → LiveKit (VPS) → Python Agent (Home Server)
        → Faster-Whisper → Ollama (AI Server) → [n8n webhooks] → Ollama
        → Kokoro TTS → Browser
```

## Machines

The system is built for **distributed infrastructure**: three machines, each
running only the software it needs. Clone the same repository on each; each
machine uses only its own folders.

### Machine 1 — Public VPS (2 GB RAM)

Runs public-facing services only:

| Folder | Purpose |
|---|---|
| `frontend/` | Next.js web console (browser UI) |
| `livekit/` | LiveKit server config + run instructions |

No AI inference, no databases, no speech models. Connects to the Home Server
over **Tailscale** only for the agent's token/history API.

### Machine 2 — Home Server

The orchestration server. Runs the entire conversation pipeline:

| Folder | Purpose |
|---|---|
| `agent/` | Python LiveKit agent: session orchestration, FastAPI helper (token + history), clients (Whisper, Ollama, Kokoro, n8n), tool manager |
| `shared/` | Cross-module contracts the agent consumes |

Also hosts (already installed, not recreated): **n8n**, **PostgreSQL**,
**Redis**. Communicates with Ollama over the **local LAN** (not localhost).

### Machine 3 — AI Server

Dedicated to **Ollama only**. Nothing else belongs here; there is no code or
folder for this machine in the repo. It exposes an OpenAI-compatible HTTP API
reachable from the Home Server's LAN IP (e.g. `http://192.168.x.x:11434`).

## Network flow

```
Browser (anywhere)
  │  microphone audio / TTS playback / data channel
  ▼
LiveKit (VPS, public wss://)
  ▲                              ▲
  │ joined as participant        │ joined as participant
  ▼                              │
Python Agent (Home Server) ──────┘
  │ POST /token + GET /history (browser → agent over Tailscale)
  │
  ├── Faster-Whisper (local STT)
  ├── Ollama (AI Server, LAN: http://192.168.x.x:11434)
  │     └── tool calls → n8n webhooks (Home Server)
  └── Kokoro TTS (local, HTTP wrapper)
```

The browser never communicates directly with Ollama, Whisper, Kokoro,
PostgreSQL, Redis, or n8n. The Python Agent is the only orchestration layer.
LiveKit keys/secrets exist only on the agent (Home Server); the browser
receives a short-lived JWT from the agent's `POST /token`.

## Repository layout

| Folder | Deployed to | What it is |
|---|---|---|
| `frontend/` | VPS | Next.js voice console (README inside) |
| `livekit/` | VPS | LiveKit config + run instructions (README inside) |
| `agent/` | Home Server | Python agent + FastAPI helper (README inside) |
| `shared/` | Home Server (via agent); referenced by frontend | Canonical contracts: `schemas/`, `contracts/`, `types/`, `configuration/env-conventions.md` |
| `docs/` | any | Architecture, API, webhook integration, project overview |

## Startup order

1. **Start LiveKit on the VPS** (`cd livekit` → follow `livekit/README.md`).
2. **Start the Python Agent on the Home Server** (`cd agent` → follow
   `agent/README.md`) — it joins rooms and exposes `POST /token` on
   `AGENT_HOST:AGENT_PORT`.
3. **Ensure Faster-Whisper and Kokoro are running on the Home Server**
   (Whisper loads in-process; Kokoro must expose its HTTP wrapper on
   `TTS_BASE_URL`).
4. **Verify connectivity to the Ollama server over the LAN**:
   `curl http://192.168.x.x:11434/v1/models` from the Home Server; set
   `OLLAMA_BASE_URL` to that LAN address in `agent/.env`.
5. **Start the frontend on the VPS** (`cd frontend` → follow
   `frontend/README.md`): `npm install`, `npm run build`, `npm run start`.
6. **Open the application in the browser**, press Connect, and verify the
   full conversation flow (transcript, tool calls, audio reply).

## Configuration

Environment variables are **separated by component** — never mixed:

- `frontend/.env.example` — browser-side URLs
- `agent/.env.example` — LiveKit, Ollama (LAN), Whisper, Kokoro, n8n webhooks, logging
- `livekit/.env.example` — LiveKit connection values shared with the other two

Canonical names and defaults: `shared/configuration/env-conventions.md`.

## Quick reference (per machine)

```bash
# VPS — frontend
cd frontend && cp .env.example .env.local   # fill LIVEKIT_URL + AGENT_API_URL (Tailscale)
npm install && npm run build && npm run start

# VPS — livekit
cd livekit && cp livekit.yaml.example livekit.yaml && cp .env.example .env
livekit-server --config livekit.yaml        # or: livekit-server --dev

# Home Server — agent
cd agent && cp .env.example .env             # fill LIVEKIT_*, OLLAMA_BASE_URL (LAN), N8N_WEBHOOK_BASE_URL
pip install -e . && agent-run                # agent API on :8080

# AI Server — already running Ollama; verify from Home Server:
curl http://192.168.x.x:11434/v1/models
```

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — full pipeline, module responsibilities, session lifecycle
- [docs/API.md](docs/API.md) — FastAPI surface + data-channel event reference
- [docs/WEBHOOKS.md](docs/WEBHOOKS.md) — n8n integration, example payloads, adding tools
- [docs/PROJECT_OVERVIEW.md](docs/PROJECT_OVERVIEW.md) — goals, constraints, extension points
- `shared/` — the source-of-truth contracts (schemas, env conventions, webhook shapes)
