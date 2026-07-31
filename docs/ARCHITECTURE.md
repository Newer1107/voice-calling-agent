# Architecture

The AI Voice Agent is a realtime voice pipeline. The browser streams microphone
audio through LiveKit to a Python agent worker, which transcribes it locally
(Faster-Whisper), generates a response with a local LLM (Ollama), optionally
calls n8n webhooks for business operations, and streams synthesized speech
(Kokoro) back to the browser. All realtime state, transcripts, indicators, and
errors flow over the LiveKit data channel as typed events pinned in
`shared/schemas/events.schema.json`.

## Pipeline

```
+--------------------------------------------------------------+
| BROWSER  (frontend/, Next.js + LiveKit React SDK)            |
|   mic capture  Â·  audio playback  Â·  transcript/state UI     |
+--------------------------------------------------------------+
        â”‚  audio tracks                       â”‚  data channel
        â–¼                                    â–¼
+--------------------------------------------------------------+
| LIVEKIT SERVER                                               |
|   WebRTC media transport, signaling, data-channel relay      |
+--------------------------------------------------------------+
        â”‚  agent joins the room as a participant
        â–¼
+--------------------------------------------------------------+
| AGENT WORKER  (agent/, Python)                               |
|  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â” |
|  â”‚ VAD (Silero) â”‚â†’ â”‚ STT (Faster-     â”‚  â”‚ TTS (Kokoro    â”‚ |
|  â”‚ endpointing  â”‚  â”‚ Whisper)         â”‚  â”‚ via local HTTP)â”‚ |
|  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜ |
|         (STTClient / TTSClient interfaces, replaceable)      |
|  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â” |
|  â”‚ LLM LAYER Â· Ollama /v1/chat/completions Â· tool calling â”‚ |
|  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜ |
|  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â” |
|  â”‚ TOOL LAYER Â· ToolManager registry â†’ thin webhook calls â”‚ |
|  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜ |
|  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â” |
|  â”‚ FASTAPI HELPER Â· POST /token Â· GET /health Â·           â”‚ |
|  â”‚                   GET /history/{session_id}            â”‚ |
|  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜ |
+--------------------------------------------------------------+
        â”‚  HTTPS, normalized request/response envelopes
        â–¼
+--------------------------------------------------------------+
| n8n  (owns ALL business logic, exposed as webhook workflows) |
+--------------------------------------------------------------+
```

The FastAPI helper runs in the same process as the agent worker
(`ENABLE_AGENT_API` gates it). Speech models: Whisper and Kokoro run locally
on the Home Server; Ollama runs on a separate AI Server reachable over the
LAN (`OLLAMA_BASE_URL`, e.g. `http://192.168.x.x:11434` — never localhost).
n8n may run anywhere reachable over HTTP. Realtime transport is **LiveKit
Cloud** (managed — the agent and browser join the same room, no self-hosted
LiveKit).

## Module responsibilities

### frontend/ (Next.js + LiveKit React SDK)

- Connects to the LiveKit room using a short-lived JWT from `POST /token`.
- Captures microphone audio and plays back the agent's audio stream.
- Sends browser â†’ agent messages on the data channel: push-to-talk
  (`client.ptt.start`, `client.ptt.stop`) and config (`client.config`).
- Receives agent â†’ browser events and renders transcripts, listening /
  thinking / speaking indicators, tool activity, and errors.
- Never holds n8n or LiveKit secrets. It knows only
  `NEXT_PUBLIC_LIVEKIT_URL` and `NEXT_PUBLIC_AGENT_API_URL`.

### agent worker (Python, LiveKit Agents framework)

Joins the room as the agent participant and runs the conversation loop. It is
the only component that talks to the local speech stack and n8n.

| Layer | What it does | Replaced by |
|---|---|---|
| VAD (Silero) | Detects speech and silence to segment the user's turn (`VAD_*` env) | - (swappable implementation) |
| STT | Faster-Whisper transcription, streams `transcript.partial` then `transcript.final` | `STTClient` protocol |
| LLM | Ollama via OpenAI-compatible `/v1/chat/completions`; chooses tool calls; streams the reply | any OpenAI-compatible endpoint |
| TTS | Kokoro through the local HTTP API (`TTS_BASE_URL`), plays synthesized audio | `TTSClient` protocol |
| ToolManager | Registry of tools (name, description, argument JSON Schema, webhook URL); executes tool calls as HTTP POSTs to n8n | add tools, no agent plumbing |
| Realtime state | Publishes `state.*`, `agent.message.*`, `tool.*`, `error` events on the data channel | - |
| Session memory | Keeps the conversation history per session, capped by `SESSION_HISTORY_LIMIT` | - |

### FastAPI helper

Small HTTP surface used by the browser and for debugging: `POST /token`
(issues the LiveKit JWT), `GET /health`, `GET /history/{session_id}`. See
[API.md](API.md).

### n8n

Holds every business rule (booking, orders, customers, inventory, email).
Exposed only as HTTP webhook workflows; the agent never calls the n8n API.
Each tool maps 1:1 to one webhook workflow. See [WEBHOOKS.md](WEBHOOKS.md).

## Realtime event flow

Every message on the data channel uses one envelope (pinned by the schema):

```json
{ "type": "transcript.final", "sessionId": "a3f9c1e2-...", "timestamp": "2026-08-03T14:30:00Z", "payload": { "text": "Book me a consultation" } }
```

- Agent â†’ browser: `agent.*`, `state.*`, `transcript.*`, `tool.*`, `error`.
- Browser â†’ agent: `client.ptt.start`, `client.ptt.stop`, `client.config`.
- Both sides ignore unknown message types for forward compatibility.

The full reference (every type, payload fields, publisher) is in
[API.md](API.md#livekit-data-channel-events).

## Session lifecycle

```
connect â†’ welcome â†’ listen â†’ think â†’ [tool loop] â†’ speak â†’ disconnect
```

1. **Connect.** The browser fetches a token, joins the room, and the agent
   worker joins as a participant. The agent publishes `state.connected`.
2. **Welcome.** The agent speaks its greeting and publishes `agent.welcome`
   (payload carries the greeting text and session/conversation ids).
3. **Listen.** `state.listening` (`active: true`, source `vad` or `ptt`).
   The user speaks. `transcript.partial` events stream as words are
   recognized, then a `transcript.final` closes the user turn.
4. **Think.** `state.thinking` (`active: true`). The LLM produces a response.
   If the LLM emits a tool call: `tool.call` â†’ webhook POST to n8n â†’
   `tool.result` (or `tool.error`) â†’ the result feeds back to the LLM, and
   the loop repeats until the LLM returns a final answer. If the LLM fails,
   `error` (`llm_failed`) is published and the turn recovers.
5. **Speak.** `state.speaking` (`active: true`). The reply streams to the
   browser as `agent.message.start` â†’ `agent.message.delta` (Ã—n) â†’
   `agent.message.done`, while TTS audio plays back.
6. **Disconnect.** The browser leaves the room. Session memory may be
   inspected afterwards via `GET /history/{session_id}`.

## Design principles

1. **Replaceable speech stack.** STT and TTS sit behind small client
   interfaces (`STTClient`, `TTSClient`). Faster-Whisper and Kokoro are the
   default implementations, not part of the core loop.
2. **LLM is an endpoint, not a dependency.** The agent talks to Ollama over
   its OpenAI-compatible API, so any OpenAI-compatible provider can be
   substituted with an env change (`OLLAMA_BASE_URL`, `OLLAMA_MODEL`).
3. **Tools are thin webhook forwarders.** ToolManager turns a tool call into
   one HTTP POST to a configured n8n webhook and hands the normalized response
   back to the LLM. Zero business logic lives in the agent. The agent never
   fabricates success: a failed webhook always surfaces as a failure.
4. **Secrets only server-side.** LiveKit credentials and n8n URLs exist only
   in `agent/.env`. The browser receives a short-lived JWT from the FastAPI
   helper and never sees a secret.
5. **Local-first speech.** STT, LLM, and TTS run locally by default, so the
   voice loop works without cloud speech APIs and keeps audio on the machine.
6. **Typed, forward-compatible events.** All realtime state is a typed
   message on the data channel. Unknown types are ignored, so the frontend
   and agent can evolve independently.

## Related documents

- [API.md](API.md) - HTTP surface and data-channel event reference
- [WEBHOOKS.md](WEBHOOKS.md) - n8n webhook integration and tool recipes
- [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md) - goals, constraints, stack
- `shared/` - the contracts these docs are derived from
