# frontend/

Next.js voice-agent web console. The
browser UI for the voice agent: connect/disconnect, push-to-talk + voice
activity mode, live user + AI transcripts, conversation history, connection
status, speaking/listening/thinking indicators, and error toasts.

The frontend talks to exactly two things:

1. **LiveKit Cloud** — for the microphone audio, streamed TTS
   playback, and the realtime data channel.
2. **The Python agent's FastAPI helper** (Home Server) — for
   `POST /token` (get a short-lived LiveKit join token) and
   `GET /history/{sessionId}`.

It never talks to Ollama, Whisper, Kokoro, n8n, PostgreSQL, or Redis — the
Python agent is the only orchestration layer.

## Prerequisites

- Node.js 18+ (tested with Node 24)
- A reachable LiveKit Cloud URL (see `../livekit/README.md`)
- A reachable agent API URL — the Home Server's address, e.g.
  `http://192.168.x.x:8080`

## Required environment variables

Copy `.env.example` to `.env.local` and fill:

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_LIVEKIT_URL` | LiveKit Cloud URL the browser connects to, e.g. `wss://<your-project>.livekit.cloud` |
| `NEXT_PUBLIC_AGENT_API_URL` | Agent FastAPI base URL, e.g. `http://192.168.x.x:8080` (Home Server, reachable from the browser) |
| `NEXT_PUBLIC_AGENT_NAME` | Optional display name for the agent (default `Voice Agent`) |

These are inlined at **build time** — set them before `npm run build`.

## Installation

```bash
npm install
```

## Build

```bash
npm run build
```

## Run

```bash
npm run start      # production server on :3000
# or during development:
npm run dev        # dev server on :3000
```

## Health check

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000   # expect 200
```

Full functional check: open the app in a browser, press **Connect**, allow the
microphone, and speak — the agent's reply should stream back as audio. The
Connect button must reach `NEXT_PUBLIC_AGENT_API_URL/token`, so verify that
URL is reachable from the browser first:

```bash
curl -s -X POST http://<agent-api-url>/token \
  -H 'Content-Type: application/json' -d '{"roomName":"test"}'
```

## Notes

- The agent API must allow this origin — set `AGENT_CORS_ORIGINS` in
  `agent/.env` to include the frontend's origin (e.g. `http://localhost:3000`
  in dev, or the production URL).
- Real-time events follow `../shared/schemas/events.schema.json`; the typed
  TS mirror lives in `lib/types.ts` (keep them in sync).

## Files

| Path | Purpose |
|---|---|
| `app/` | Next.js App Router shell (layout, page) |
| `components/` | ConnectionPanel, ControlsPanel, TranscriptPanel, HistoryPanel, ToolActivity, ErrorToasts |
| `hooks/use-voice-agent.ts` | Orchestrating hook: room lifecycle, event routing, UI state |
| `lib/voice-room.ts` | livekit-client Room wrapper (connect/reconnect, mic, data channel) |
| `lib/agent-api.ts` | Token + history client for the agent FastAPI |
| `lib/types.ts` | Typed mirror of the shared event schema |
