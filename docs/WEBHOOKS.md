# n8n Webhook Integration

All business logic lives in n8n. The agent's ToolManager never calls the n8n
API and never implements business rules; each tool maps 1:1 to an n8n workflow
exposed as an HTTP webhook. The agent only forwards the LLM's tool call as an
HTTP POST and hands the normalized response back to the LLM.

Contract source: `shared/contracts/webhook.md`.

## Request envelope

`POST {N8N_WEBHOOK_BASE_URL}/{toolPath}` with a JSON body:

```json
{
  "tool": "bookAppointment",
  "sessionId": "a3f9c1e2-0000-0000-0000-000000000001",
  "params": {
    "customerName": "Sarah",
    "session": "Yoga Basics",
    "date": "2026-08-05",
    "time": "18:30"
  }
}
```

| Field | Type | Description |
|---|---|---|
| `tool` | string | Tool name, must match the registered tool |
| `sessionId` | string | Stable conversation id, for logging and traceability on the n8n side |
| `params` | object | Tool arguments the LLM produced, per the tool's argument JSON Schema |

The URL path per tool is the tool's configured suffix (or a fixed path such as
`/book-appointment`) appended to `N8N_WEBHOOK_BASE_URL`. See the example
payloads below for the exact paths.

## Response envelope

n8n workflows must return JSON with a normalized envelope:

```json
{ "ok": true, "data": { "bookingId": "GYM-3482", "session": "Yoga Basics", "status": "confirmed" } }
```

or, on failure:

```json
{ "ok": false, "error": "No slots available on 2026-08-03" }
```

| Field | Type | Meaning |
|---|---|---|
| `ok` | boolean | Success flag (**required**) |
| `data` | object \| null | Result payload on success |
| `error` | string \| null | Human-readable failure reason |

## Validation and failure handling (agent side)

1. **Shape check.** The response must be valid JSON with a boolean `ok`.
   Anything else is an invalid tool response, surfaced to the LLM as
   `tool.error`; the conversation continues.
2. **HTTP status.** `2xx` passes. `4xx` is a caller fault: forward the
   `error` if it is parseable. `5xx`, network errors, and timeouts are
   transient: retry up to `N8N_WEBHOOK_MAX_RETRIES` with backoff.
3. **`ok: false`.** The tool failed for a known reason. The LLM receives the
   `error` string and can ask the user to adjust their input, so the
   conversation continues naturally.
4. **Timeout.** A call that exceeds `N8N_WEBHOOK_TIMEOUT_MS` reports failure
   to the LLM.
5. **Never fabricate success.** A failed webhook always surfaces as a failure
   (`tool.error` on the data channel, failure text to the LLM). The agent
   never invents `ok: true`.

## Example payloads

All examples use `N8N_WEBHOOK_BASE_URL` = `https://n8n.example.com/webhook`
and the same `sessionId` for readability.

### bookAppointment → `POST /webhook/voice-agent/book-appointment`

Request:

```json
{
  "tool": "bookAppointment",
  "sessionId": "a3f9c1e2-0000-0000-0000-000000000001",
  "params": {
    "customerName": "Sarah",
    "session": "Yoga Basics",
    "date": "2026-08-05",
    "time": "18:30"
  }
}
```

Response:

```json
{ "ok": true, "data": { "bookingId": "GYM-3482", "session": "Yoga Basics", "date": "2026-08-05", "time": "18:30", "member": "Sarah", "status": "confirmed" } }
```

Failure example (a known reason, `ok: false`):

```json
{ "ok": false, "error": "No slots available on 2026-08-05" }
```

### lookupCustomer → `POST /webhook/voice-agent/lookup-customer`

Request:

```json
{
  "tool": "lookupCustomer",
  "sessionId": "a3f9c1e2-0000-0000-0000-000000000001",
  "params": { "email": "sarah@example.com" }
}
```

Response:

```json
{ "ok": true, "data": { "memberId": "M-824", "name": "sarah@example.com", "tier": "Gold", "membershipStatus": "active", "visitsThisMonth": 12 } }
```

Failure example:

```json
{ "ok": false, "error": "No customer found for sarah@example.com" }
```

### createOrder → `POST /webhook/voice-agent/create-order`

Request:

```json
{
  "tool": "createOrder",
  "sessionId": "a3f9c1e2-0000-0000-0000-000000000001",
  "params": {
    "customerName": "Sarah",
    "items": [{ "name": "Resistance Band", "quantity": 2 }]
  }
}
```

Response:

```json
{ "ok": true, "data": { "orderId": "ORD-5530", "member": "Sarah", "items": [{ "name": "Resistance Band", "quantity": 2 }], "total": "59.00 GBP", "status": "processing" } }
```

Failure example:

```json
{ "ok": false, "error": "Resistance Band is out of stock" }
```

### checkInventory → `POST /webhook/voice-agent/check-inventory`

Request:

```json
{
  "tool": "checkInventory",
  "sessionId": "a3f9c1e2-0000-0000-0000-000000000001",
  "params": { "productName": "Kettlebell 16kg" }
}
```

Response:

```json
{ "ok": true, "data": { "item": "Kettlebell 16kg", "available": 5, "inStock": true, "location": "Gym Floor" } }
```

Failure example:

```json
{ "ok": false, "error": "Kettlebell 16kg not found" }
```

### sendEmail → `POST /webhook/voice-agent/send-email`

Request:

```json
{
  "tool": "sendEmail",
  "sessionId": "a3f9c1e2-0000-0000-0000-000000000001",
  "params": {
    "to": "sarah@example.com",
    "subject": "Booking confirmed"
  }
}
```

Response:

```json
{ "ok": true, "data": { "messageId": "MSG-7536", "to": "sarah@example.com", "subject": "Booking confirmed", "status": "sent" } }
```

Failure example:

```json
{ "ok": false, "error": "Recipient address rejected by mail server" }
```

## Adding a new tool

1. **Register the tool** in `agent/src/voice_agent/tools/manager.py`: name,
   a description the LLM can understand, the JSON Schema for its arguments,
   and the webhook path or full URL.
2. **Create the matching n8n workflow**, exposed as a webhook that accepts the
   request envelope above and returns `{ ok, data | error }`.
3. **Done.** The LLM discovers the tool from its registry entry, and the
   frontend renders `tool.call` / `tool.result` events generically. No agent
   plumbing and no frontend changes are required.

Guidelines for new tools:

- Keep the tool description concrete so the LLM knows when to call it and
  what the arguments mean. The description is the tool's only documentation
  from the LLM's perspective.
- Keep `params` flat and small. The argument JSON Schema is what the LLM
  fills, so simple shapes produce more reliable calls.
- Always return the normalized envelope from the n8n workflow, including
  `ok: false` with a readable `error` for expected failures. The agent treats
  anything else as an invalid tool response.

## See also

- [API.md](API.md) - `tool.call` / `tool.result` / `tool.error` events on the
  data channel, and the `tool_failed` error code
- [ARCHITECTURE.md](ARCHITECTURE.md) - where ToolManager sits in the pipeline
