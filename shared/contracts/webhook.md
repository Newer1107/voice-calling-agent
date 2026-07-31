# n8n Webhook Tool Contract

The agent's Tool Manager calls n8n **only** through configurable HTTP webhook endpoints.
No business logic lives in the agent — each tool maps 1:1 to an n8n workflow that owns the
actual operation (booking, order creation, customer lookup, inventory, email, …).

## Request

`POST {N8N_WEBHOOK_BASE_URL}/{toolPath}` — JSON body:

```json
{
  "tool": "bookAppointment",
  "sessionId": "a3f9c1e2-...",
  "params": {
    "customerName": "Ada Lovelace",
    "date": "2026-08-03",
    "time": "14:30",
    "service": "Consultation"
  }
}
```

| Field | Type | Description |
|---|---|---|
| `tool` | string | Tool name (matches the registered tool) |
| `sessionId` | string | Stable conversation id (for logging/traceability on the n8n side) |
| `params` | object | Tool arguments the LLM produced |

The URL path per tool is configured in the Tool Manager registry (`N8N_WEBHOOK_BASE_URL` +
per-tool suffix). A tool may also declare a **fixed path** (e.g. `/book-appointment`) instead
of a generic one.

> **Live endpoints (n8n instance at `n8n.raunaktech.site`)** — workflow "Voice Agent
> Tools" (`f0fAYExKKteCL4cj`, active). The ToolManager builds `{N8N_WEBHOOK_BASE_URL}/{toolPath}`.
> Set `N8N_WEBHOOK_BASE_URL=https://n8n.raunaktech.site/webhook/voice-agent` and the agent's
> per-tool paths resolve correctly:
>
> | Tool | Full URL (agent sends `{base}/book-appointment` style) |
> |---|---|
> | bookAppointment | `https://n8n.raunaktech.site/webhook/voice-agent/book-appointment` |
> | createOrder | `https://n8n.raunaktech.site/webhook/voice-agent/create-order` |
> | lookupCustomer | `https://n8n.raunaktech.site/webhook/voice-agent/lookup-customer` |
> | checkInventory | `https://n8n.raunaktech.site/webhook/voice-agent/check-inventory` |
> | sendEmail | `https://n8n.raunaktech.site/webhook/voice-agent/send-email` |
>
> All five verified live with the `{ok, data}` envelope. The workflow must be **active**
> (it is) for production webhook calls to respond.

## Response

n8n workflows must return JSON with a normalized envelope:

```json
{ "ok": true, "data": { "appointmentId": "APT-1042", "status": "confirmed" } }
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

## Validation & failure handling (agent side)

1. **Shape check** — response must be valid JSON with a boolean `ok`. Anything else is an
   invalid tool response → surfaced to the LLM as `tool.error`, conversation continues.
2. **HTTP status** — 2xx passes; 4xx = caller fault (forward `error` if parseable);
   5xx/network/timeout = transient → retry up to `N8N_WEBHOOK_MAX_RETRIES` with backoff.
3. **`ok: false`** — the tool failed *for a known reason*; the LLM receives the `error`
   string and can ask the user to adjust input, so the conversation continues naturally.
4. **Timeout** — `N8N_WEBHOOK_TIMEOUT_MS`; on timeout the tool reports failure to the LLM.
5. The agent **never** fabricates success — a failed webhook always surfaces as a failure.

## Example n8n payloads

### bookAppointment → `POST /webhook/voice-agent/book-appointment`

```json
{
  "tool": "bookAppointment",
  "sessionId": "a3f9c1e2-0000-0000-0000-000000000001",
  "params": {
    "customerName": "Ada Lovelace",
    "date": "2026-08-03",
    "time": "14:30",
    "service": "Consultation",
    "email": "ada@example.com"
  }
}
```

Response: `{ "ok": true, "data": { "appointmentId": "APT-1042", "status": "confirmed" } }`

### lookupCustomer → `POST /webhook/voice-agent/lookup-customer`

```json
{
  "tool": "lookupCustomer",
  "sessionId": "a3f9c1e2-0000-0000-0000-000000000001",
  "params": { "email": "ada@example.com" }
}
```

Response: `{ "ok": true, "data": { "customerId": "C-88", "name": "Ada Lovelace", "tier": "gold" } }`

### createOrder → `POST /webhook/voice-agent/create-order`

```json
{
  "tool": "createOrder",
  "sessionId": "a3f9c1e2-0000-0000-0000-000000000001",
  "params": {
    "customerId": "C-88",
    "items": [{ "sku": "VAS-01", "qty": 2 }],
    "shipTo": { "city": "London", "postcode": "N1 9GU" }
  }
}
```

Response: `{ "ok": true, "data": { "orderId": "ORD-5520", "total": "84.50 GBP" } }`

### sendEmail → `POST /webhook/voice-agent/send-email`

```json
{
  "tool": "sendEmail",
  "sessionId": "a3f9c1e2-0000-0000-0000-000000000001",
  "params": { "to": "ada@example.com", "subject": "Appointment confirmed", "body": "See you 2026-08-03 at 14:30." }
}
```

Response: `{ "ok": true, "data": { "messageId": "MSG-7" } }`

## Adding a new tool

1. In `agent/src/voice_agent/tools/manager.py` register a tool: name, description, JSON
   Schema for arguments, and the webhook path/URL.
2. Create the matching n8n workflow, exposed as a webhook that accepts the envelope above
   and returns `{ ok, data | error }`.
3. The LLM discovers the tool from its registry entry — no agent code changes needed.

See `docs/ARCHITECTURE.md` for the tool-manager flow diagram.
