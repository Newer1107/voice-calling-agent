# shared/types/

Typed views over the canonical JSON Schemas in `../schemas/`.

## Source of truth

- `../schemas/events.schema.json` — the realtime data-channel event envelope
  and every message type (agent → browser: `agent.*`, `state.*`,
  `transcript.*`, `error`; browser → agent: `client.*`).
- `../schemas/webhook-envelope.schema.json` — the n8n tool request/response
  envelopes.

## Consumption

- **Frontend (TypeScript):** the compiled mirror lives in
  `frontend/lib/types.ts` (discriminated union + runtime type guards). It must
  stay in sync with `schemas/events.schema.json` — when the schema changes,
  update the TS types in the same change.
- **Agent (Python):** the event envelope is emitted verbatim by
  `agent/src/voice_agent/events.py` (name `EventPublisher`), which publishes
  exactly the `{type, sessionId, timestamp, payload}` shape.

## Deriving types from the schema

The schema is the contract; both sides derive their types from it:

```
shared/schemas/events.schema.json
        │
        ├──▶ frontend/lib/types.ts   (TS discriminated union + guards)
        └──▶ agent/events.py         (envelope publisher, python-typed payloads)
```

If a type is missing in one side, the schema is the arbiter — fix the side,
not the schema (unless the schema itself is wrong, in which case change the
schema and both sides together).
