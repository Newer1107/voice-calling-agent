# livekit/

Connection reference for **LiveKit Cloud** — the managed realtime transport.
LiveKit Cloud handles WebRTC, audio transport, room management, and
participant management. It does **not** run any AI, STT, TTS, or business
logic — the Python agent on the Home Server owns all of that.

This folder has no code to run on your side: LiveKit Cloud is fully managed.
It exists so the connection values the browser and the agent both need live
in one well-defined place.

## LiveKit Cloud responsibilities

- WebRTC media transport (browser microphone in, TTS audio out)
- Room + participant management
- Data channel relay (realtime state events between browser and agent)

It is **not** responsible for: AI, STT, TTS, business logic, or n8n.

## Prerequisites

- A [LiveKit Cloud](https://cloud.livekit.io) project (free tier is fine).
- From the project dashboard: the WebSocket URL (`wss://…`) and a
  **Project API key/secret** pair. The secret is server-side only — it is
  used by the Python agent to sign JWTs; the browser never sees it.

## Required environment variables

Copy `.env.example` to `.env` and fill with your LiveKit Cloud project values.
These are shared by `frontend/` and `agent/` — keep them in sync:

| Variable | Purpose |
|---|---|
| `LIVEKIT_URL` | LiveKit Cloud WebSocket URL, e.g. `wss://abc123.livekit.cloud` (browser + agent connect here) |
| `LIVEKIT_API_KEY` | LiveKit Cloud API key (server-side signing; set in `agent/.env`) |
| `LIVEKIT_API_SECRET` | LiveKit Cloud API secret (server-side signing; set in `agent/.env`) |

## Install / build / run

Nothing to install, build, or run — LiveKit Cloud is a managed service.
Create the project in the dashboard, note the URL + keys, and move on.

## Health check

```bash
# The browser can reach LiveKit Cloud (replace with your URL):
curl -s -o /dev/null -w "%{http_code}\n" https://<your-project>.livekit.cloud
# expect a WebSocket-ish response code (101/400/426) — not a connection error
```

The real health check is end-to-end: start the agent, start the frontend,
click **Connect** — the browser and the agent both join the same room.

## Wiring to the rest of the system

- `frontend/.env.local`: `NEXT_PUBLIC_LIVEKIT_URL` = the same `LIVEKIT_URL`.
- `agent/.env`: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` — the
  agent signs short-lived join tokens with the key/secret; the browser gets
  one from the agent's `POST /token` and never sees the secret.

## Files

| File | Purpose |
|---|---|
| `.env.example` | The connection values to share with frontend/ and agent/ |
| `README.md` | This file |
