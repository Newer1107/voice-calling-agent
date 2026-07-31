# API Reference

The agent exposes two surfaces:

1. **HTTP (FastAPI helper)** - a small REST API for token issuance, health,
   and session history. Gated by `ENABLE_AGENT_API`; binds to `AGENT_HOST`
   / `AGENT_PORT` (default `0.0.0.0:8080`).
2. **LiveKit data channel** - the realtime event channel between the agent
   and the browser. Message types are pinned in
   `shared/schemas/events.schema.json`; both sides derive their own types
   from that file.

Base URL: `http://<AGENT_HOST>:<AGENT_PORT>`.

---

## HTTP surface (FastAPI helper)

### POST /token

Issues a short-lived LiveKit access token (JWT) for the browser. The JWT is
signed server-side with `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`; the browser
never receives the secrets.

**Request**

```json
{}
```

The body is optional. It may carry a display identity to attach to the
participant:

```json
{ "identity": "browser-user-42" }
```

| Field | Type | Required | Description |
|---|---|---|---|
| `identity` | string | no | Participant identity used when joining the LiveKit room |

**Response `200 OK`**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "url": "wss://your-livekit.example.com",
  "identity": "browser-user-42",
  "expiresAt": "2026-08-03T14:45:00Z"
}
```

| Field | Type | Description |
|---|---|---|
| `token` | string | LiveKit JWT, valid for a short window |
| `url` | string | LiveKit server URL to connect to (mirrors `LIVEKIT_URL`) |
| `identity` | string | Identity the token was issued for |
| `expiresAt` | string | ISO-8601 UTC expiry of the token |

**Errors**

| Status | Meaning |
|---|---|
| `401` | LiveKit credentials missing or misconfigured (no token can be signed) |
| `500` | Token issuance failed |

### GET /health

Liveness check for the agent process.

**Response `200 OK`**

```json
{ "status": "ok" }
```

`status` is always `"ok"` while the agent API is running. The endpoint is
meant as a process liveness check, not a dependency check: local services
(Ollama, Kokoro, n8n) are reached lazily during a conversation.

### GET /history/{session_id}

Returns the conversation memory currently held for a session, capped at
`SESSION_HISTORY_LIMIT` messages (default 50). History lives in process
memory, so a worker restart clears it. Unknown sessions return an empty list.

**Response `200 OK`**

```json
{
  "sessionId": "a3f9c1e2-0000-0000-0000-000000000001",
  "count": 3,
  "messages": [
    { "role": "user", "text": "Book me a consultation", "timestamp": "2026-08-03T14:30:02Z" },
    { "role": "assistant", "text": "I found a slot at 14:30. Shall I book it?", "timestamp": "2026-08-03T14:30:05Z" },
    { "role": "tool", "text": "bookAppointment ok: APT-1042 confirmed", "timestamp": "2026-08-03T14:30:08Z" }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `sessionId` | string | The requested session id |
| `count` | number | Number of messages returned |
| `messages[]` | array | Conversation history, newest last |
| `messages[].role` | string | `user` \| `assistant` \| `tool` |
| `messages[].text` | string | Message text (tool entries are short result summaries) |
| `messages[].timestamp` | string | ISO-8601 UTC |

---

## LiveKit data-channel events

### Envelope

Every message on the data channel has the same shape:

| Field | Type | Description |
|---|---|---|
| `type` | string | One of the message types below |
| `sessionId` | string | Stable id for the conversation session |
| `timestamp` | string | ISO-8601 UTC |
| `payload` | object | Type-specific fields, described per type |

Both sides **ignore unknown types** for forward compatibility.

### Message types

| Type | Direction | Payload fields | Description |
|---|---|---|---|
| `agent.welcome` | agent â†’ browser | `text`, `sessionId?`, `conversationId?` | Greeting shown and spoken when the session starts |
| `agent.message.start` | agent â†’ browser | `messageId` | A new agent reply begins (before TTS audio) |
| `agent.message.delta` | agent â†’ browser | `messageId`, `text` | Incremental fragment of the streaming reply |
| `agent.message.done` | agent â†’ browser | `messageId`, `text` | Full final reply text |
| `transcript.partial` | agent â†’ browser | `text` | Live partial transcription of the user's speech |
| `transcript.final` | agent â†’ browser | `text`, `confidence?`, `language?` | Final transcript of one user turn |
| `tool.call` | agent â†’ browser | `tool`, `arguments` | LLM requested a tool; the webhook call begins |
| `tool.result` | agent â†’ browser | `tool`, `ok`, `summary`, `data?` | Webhook call succeeded (or failed cleanly) |
| `tool.error` | agent â†’ browser | `tool`, `message` | Webhook call could not be completed |
| `state.connected` | agent â†’ browser | - | Agent joined the room; session is live |
| `state.listening` | agent â†’ browser | `active`, `source?` (`vad`\|`ptt`) | Agent is (not) listening for user speech |
| `state.speaking` | agent â†’ browser | `active` | Agent audio is (not) playing |
| `state.thinking` | agent â†’ browser | `active` | LLM is (not) generating |
| `error` | agent â†’ browser | `code`, `message`, `recoverable?` | A pipeline stage failed; see error codes below |
| `client.ptt.start` | browser â†’ agent | - (empty) | Push-to-talk held: listen now |
| `client.ptt.stop` | browser â†’ agent | - (empty) | Push-to-talk released: end the turn |
| `client.config` | browser â†’ agent | `vadEnabled?`, `language?` | Runtime config update from the client |

`payload` fields marked `?` are optional. `client.ptt.start` / `client.ptt.stop`
must have an empty payload (`maxProperties: 0` in the schema).

### Examples

**agent.welcome**

```json
{
  "type": "agent.welcome",
  "sessionId": "a3f9c1e2-0000-0000-0000-000000000001",
  "timestamp": "2026-08-03T14:30:00Z",
  "payload": { "text": "Hi, I'm your voice assistant. How can I help?", "sessionId": "a3f9c1e2-0000-0000-0000-000000000001", "conversationId": "conv-7" }
}
```

**transcript.partial â†’ transcript.final**

```json
{ "type": "transcript.partial", "sessionId": "a3f9c1e2-0000-0000-0000-000000000001", "timestamp": "2026-08-03T14:30:02Z", "payload": { "text": "book me a cons" } }
```

```json
{ "type": "transcript.final", "sessionId": "a3f9c1e2-0000-0000-0000-000000000001", "timestamp": "2026-08-03T14:30:02Z", "payload": { "text": "book me a consultation", "confidence": 0.93, "language": "en" } }
```

**agent.message.start â†’ delta â†’ done**

```json
{ "type": "agent.message.start", "sessionId": "a3f9c1e2-0000-0000-0000-000000000001", "timestamp": "2026-08-03T14:30:06Z", "payload": { "messageId": "msg-12" } }
```

```json
{ "type": "agent.message.delta", "sessionId": "a3f9c1e2-0000-0000-0000-000000000001", "timestamp": "2026-08-03T14:30:06Z", "payload": { "messageId": "msg-12", "text": "I found a " } }
```

```json
{ "type": "agent.message.done", "sessionId": "a3f9c1e2-0000-0000-0000-000000000001", "timestamp": "2026-08-03T14:30:07Z", "payload": { "messageId": "msg-12", "text": "I found a slot at 14:30. Shall I book it?" } }
```

**tool.call / tool.result / tool.error**

```json
{ "type": "tool.call", "sessionId": "a3f9c1e2-0000-0000-0000-000000000001", "timestamp": "2026-08-03T14:30:08Z", "payload": { "tool": "bookAppointment", "arguments": { "customerName": "Ada Lovelace", "date": "2026-08-03", "time": "14:30", "service": "Consultation" } } }
```

```json
{ "type": "tool.result", "sessionId": "a3f9c1e2-0000-0000-0000-000000000001", "timestamp": "2026-08-03T14:30:09Z", "payload": { "tool": "bookAppointment", "ok": true, "summary": "Booked APT-1042, confirmed", "data": { "appointmentId": "APT-1042", "status": "confirmed" } } }
```

```json
{ "type": "tool.error", "sessionId": "a3f9c1e2-0000-0000-0000-000000000001", "timestamp": "2026-08-03T14:30:09Z", "payload": { "tool": "bookAppointment", "message": "Webhook timed out after 10000 ms" } }
```

**state.connected / listening / speaking / thinking**

```json
{ "type": "state.connected", "sessionId": "a3f9c1e2-0000-0000-0000-000000000001", "timestamp": "2026-08-03T14:30:00Z", "payload": {} }
```

```json
{ "type": "state.listening", "sessionId": "a3f9c1e2-0000-0000-0000-000000000001", "timestamp": "2026-08-03T14:30:01Z", "payload": { "active": true, "source": "vad" } }
```

```json
{ "type": "state.thinking", "sessionId": "a3f9c1e2-0000-0000-0000-000000000001", "timestamp": "2026-08-03T14:30:04Z", "payload": { "active": true } }
```

```json
{ "type": "state.speaking", "sessionId": "a3f9c1e2-0000-0000-0000-000000000001", "timestamp": "2026-08-03T14:30:06Z", "payload": { "active": true } }
```

**error**

```json
{ "type": "error", "sessionId": "a3f9c1e2-0000-0000-0000-000000000001", "timestamp": "2026-08-03T14:30:10Z", "payload": { "code": "tts_failed", "message": "Kokoro synthesis timed out", "recoverable": true } }
```

**client.ptt.start / client.ptt.stop / client.config**

```json
{ "type": "client.ptt.start", "sessionId": "a3f9c1e2-0000-0000-0000-000000000001", "timestamp": "2026-08-03T14:30:01Z", "payload": {} }
```

```json
{ "type": "client.config", "sessionId": "a3f9c1e2-0000-0000-0000-000000000001", "timestamp": "2026-08-03T14:30:01Z", "payload": { "vadEnabled": false, "language": "en" } }
```

---

## Error codes

`error` events carry a machine-readable `code` and a human-readable
`message`, plus `recoverable` (default `true`).

| Code | Stage | Meaning | Recovery semantics |
|---|---|---|---|
| `stt_failed` | STT | Transcription failed (Whisper error, empty audio) | Recoverable: agent prompts the user to repeat; turn restarts from listening |
| `llm_failed` | LLM | Ollama request failed or returned nothing usable | Recoverable: agent retries per `OLLAMA_MAX_RETRIES`, then tells the user it could not answer and resumes listening |
| `tts_failed` | TTS | Kokoro synthesis or playback failed | Recoverable: the text reply is still delivered on the data channel (`agent.message.done`) and shown on screen |
| `tool_failed` | Tool | Webhook call failed or returned an invalid envelope | Recoverable: `tool.error` feeds back to the LLM, which can ask the user to adjust input or try again |
| `internal` | Agent | Unexpected agent-side failure | Check the agent log; the conversation may need to be restarted |
| `session_expired` | Session | Session ended, token expired, or the worker lost the room | Not recoverable in place: the browser must reconnect (fresh `POST /token` and room join) |

Rules that hold across stages:

- The agent **never fabricates success**. A failed webhook always surfaces as
  a failure to the LLM or the browser.
- Timeouts and retries are configurable per layer via env
  (`OLLAMA_TIMEOUT_MS`, `OLLAMA_MAX_RETRIES`, `TTS_TIMEOUT_MS`,
  `N8N_WEBHOOK_TIMEOUT_MS`, `N8N_WEBHOOK_MAX_RETRIES`).
- `recoverable: false` (e.g. `session_expired`) means the client should stop
  the current session rather than continue.
