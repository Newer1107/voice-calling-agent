/**
 * Realtime event types for the voice agent data channel.
 *
 * Shapes are pinned by `shared/schemas/events.schema.json` (authoritative).
 * Every message is an envelope `{ type, sessionId, timestamp, payload }` and
 * the union is discriminated on `type`. Browser -> agent messages (`client.*`)
 * use the same envelope; the agent must ignore unknown types, and so do we â€”
 * `parseRealtimeEvent` returns `null` for anything it does not recognise so
 * older browsers keep working against a newer agent (and vice versa).
 *
 * No external validation dependency: hand-rolled guards only.
 */

/** Every envelope carries these three fields alongside `payload`. */
interface EnvelopeFields {
  /** Stable id for the conversation session. May be empty until the agent announces one. */
  sessionId: string;
  /** ISO-8601 UTC timestamp of when the event was emitted. */
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Agent -> browser
// ---------------------------------------------------------------------------

export interface AgentWelcomeEvent extends EnvelopeFields {
  type: "agent.welcome";
  payload: {
    text: string;
    sessionId?: string;
    conversationId?: string;
  };
}

export interface AgentMessageStartEvent extends EnvelopeFields {
  type: "agent.message.start";
  payload: {
    messageId?: string;
  };
}

export interface AgentMessageDeltaEvent extends EnvelopeFields {
  type: "agent.message.delta";
  payload: {
    messageId: string;
    text: string;
  };
}

export interface AgentMessageDoneEvent extends EnvelopeFields {
  type: "agent.message.done";
  payload: {
    messageId: string;
    text: string;
  };
}

export interface TranscriptPartialEvent extends EnvelopeFields {
  type: "transcript.partial";
  payload: {
    text: string;
  };
}

export interface TranscriptFinalEvent extends EnvelopeFields {
  type: "transcript.final";
  payload: {
    text: string;
    confidence?: number;
    language?: string;
  };
}

export interface ToolCallEvent extends EnvelopeFields {
  type: "tool.call";
  payload: {
    tool: string;
    arguments: Record<string, unknown>;
  };
}

export interface ToolResultEvent extends EnvelopeFields {
  type: "tool.result";
  payload: {
    tool: string;
    ok: boolean;
    summary: string;
    data?: unknown;
  };
}

export interface ToolErrorEvent extends EnvelopeFields {
  type: "tool.error";
  payload: {
    tool: string;
    message: string;
  };
}

export interface StateConnectedEvent extends EnvelopeFields {
  type: "state.connected";
  payload: Record<string, never>;
}

export interface StateListeningEvent extends EnvelopeFields {
  type: "state.listening";
  payload: {
    active: boolean;
    source?: "vad" | "ptt";
  };
}

export interface StateSpeakingEvent extends EnvelopeFields {
  type: "state.speaking";
  payload: {
    active: boolean;
  };
}

export interface StateThinkingEvent extends EnvelopeFields {
  type: "state.thinking";
  payload: {
    active: boolean;
  };
}

export type AgentErrorCode =
  | "stt_failed"
  | "llm_failed"
  | "tts_failed"
  | "tool_failed"
  | "internal"
  | "session_expired";

export interface AgentErrorEvent extends EnvelopeFields {
  type: "error";
  payload: {
    code: AgentErrorCode;
    message: string;
    recoverable?: boolean;
  };
}

// ---------------------------------------------------------------------------
// Browser -> agent (also parseable inbound â€” e.g. echoes / other clients)
// ---------------------------------------------------------------------------

export interface ClientPttStartEvent extends EnvelopeFields {
  type: "client.ptt.start";
  payload: Record<string, never>;
}

export interface ClientPttStopEvent extends EnvelopeFields {
  type: "client.ptt.stop";
  payload: Record<string, never>;
}

export interface ClientConfigEvent extends EnvelopeFields {
  type: "client.config";
  payload: {
    vadEnabled?: boolean;
    language?: string;
  };
}

// ---------------------------------------------------------------------------
// Unions
// ---------------------------------------------------------------------------

/** Every event type the agent may emit. */
export type AgentEvent =
  | AgentWelcomeEvent
  | AgentMessageStartEvent
  | AgentMessageDeltaEvent
  | AgentMessageDoneEvent
  | TranscriptPartialEvent
  | TranscriptFinalEvent
  | ToolCallEvent
  | ToolResultEvent
  | ToolErrorEvent
  | StateConnectedEvent
  | StateListeningEvent
  | StateSpeakingEvent
  | StateThinkingEvent
  | AgentErrorEvent;

/** Every event type the browser may emit. */
export type ClientEvent =
  | ClientPttStartEvent
  | ClientPttStopEvent
  | ClientConfigEvent;

/** Discriminated union of everything that crosses the data channel. */
export type RealtimeEvent = AgentEvent | ClientEvent;

// ---------------------------------------------------------------------------
// Hand-rolled validation helpers (no zod â€” small surface, stay dependency-free)
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** `{ text: string }` â€” used by transcript.partial. */
function parseTextOnlyPayload(
  payload: unknown,
): { text: string } | null {
  if (!isRecord(payload) || !isString(payload.text)) return null;
  return { text: payload.text };
}

/** Optional `{ confidence, language }` on top of `{ text }` â€” transcript.final. */
function parseFinalPayload(
  payload: unknown,
): { text: string; confidence?: number; language?: string } | null {
  if (!isRecord(payload) || !isString(payload.text)) return null;
  const out: { text: string; confidence?: number; language?: string } = {
    text: payload.text,
  };
  if (isNumber(payload.confidence)) out.confidence = payload.confidence;
  if (isString(payload.language)) out.language = payload.language;
  return out;
}

/** agent.message.done â€” `{ messageId, text }` both required. */
function parseMessageDonePayload(
  payload: unknown,
): AgentMessageDoneEvent["payload"] | null {
  if (!isRecord(payload)) return null;
  if (!isString(payload.messageId) || !isString(payload.text)) return null;
  return { messageId: payload.messageId, text: payload.text };
}

/** agent.message.start â€” payload is optional/empty. */
function parseMessageStartPayload(
  payload: unknown,
): AgentMessageStartEvent["payload"] | null {
  if (payload === undefined) return {};
  if (!isRecord(payload)) return null;
  if (payload.messageId === undefined) return {};
  if (!isString(payload.messageId)) return null;
  return { messageId: payload.messageId };
}

/** agent.message.delta â€” `{ messageId, text }` both required. */
function parseMessageDeltaPayload(
  payload: unknown,
): AgentMessageDeltaEvent["payload"] | null {
  if (!isRecord(payload)) return null;
  if (!isString(payload.messageId) || !isString(payload.text)) return null;
  return { messageId: payload.messageId, text: payload.text };
}

/** tool.call â€” `{ tool, arguments }`. */
function parseToolCallPayload(
  payload: unknown,
): ToolCallEvent["payload"] | null {
  if (!isRecord(payload)) return null;
  if (!isString(payload.tool) || !isRecord(payload.arguments)) return null;
  return { tool: payload.tool, arguments: payload.arguments };
}

/** tool.result â€” `{ tool, ok, summary }` + optional data. */
function parseToolResultPayload(
  payload: unknown,
): ToolResultEvent["payload"] | null {
  if (!isRecord(payload)) return null;
  if (!isString(payload.tool) || !isBoolean(payload.ok) || !isString(payload.summary)) {
    return null;
  }
  const out: ToolResultEvent["payload"] = {
    tool: payload.tool,
    ok: payload.ok,
    summary: payload.summary,
  };
  if (payload.data !== undefined) out.data = payload.data;
  return out;
}

/** tool.error â€” `{ tool, message }`. */
function parseToolErrorPayload(
  payload: unknown,
): ToolErrorEvent["payload"] | null {
  if (!isRecord(payload) || !isString(payload.tool) || !isString(payload.message)) {
    return null;
  }
  return { tool: payload.tool, message: payload.message };
}

/** state.listening â€” `{ active }` + optional source. */
function parseListeningPayload(
  payload: unknown,
): StateListeningEvent["payload"] | null {
  if (!isRecord(payload) || !isBoolean(payload.active)) return null;
  const out: StateListeningEvent["payload"] = { active: payload.active };
  if (payload.source === "vad" || payload.source === "ptt") out.source = payload.source;
  return out;
}

/** state.speaking / state.thinking â€” `{ active }`. */
function parseActivePayload(payload: unknown): { active: boolean } | null {
  if (!isRecord(payload) || !isBoolean(payload.active)) return null;
  return { active: payload.active };
}

/** agent.welcome â€” `{ text }` + optional sessionId/conversationId. */
function parseWelcomePayload(
  payload: unknown,
): AgentWelcomeEvent["payload"] | null {
  if (!isRecord(payload) || !isString(payload.text)) return null;
  const out: AgentWelcomeEvent["payload"] = { text: payload.text };
  if (isString(payload.sessionId)) out.sessionId = payload.sessionId;
  if (isString(payload.conversationId)) out.conversationId = payload.conversationId;
  return out;
}

/** error â€” `{ code, message }` + optional recoverable. */
const AGENT_ERROR_CODES: readonly string[] = [
  "stt_failed",
  "llm_failed",
  "tts_failed",
  "tool_failed",
  "internal",
  "session_expired",
];

function parseErrorPayload(payload: unknown): AgentErrorEvent["payload"] | null {
  if (!isRecord(payload) || !isString(payload.code) || !isString(payload.message)) {
    return null;
  }
  if (!AGENT_ERROR_CODES.includes(payload.code)) return null;
  const out: AgentErrorEvent["payload"] = {
    code: payload.code as AgentErrorCode,
    message: payload.message,
  };
  if (isBoolean(payload.recoverable)) out.recoverable = payload.recoverable;
  return out;
}

/** client.config â€” `{ vadEnabled?, language? }`, may be empty. */
function parseClientConfigPayload(
  payload: unknown,
): ClientConfigEvent["payload"] | null {
  if (payload === undefined) return {};
  if (!isRecord(payload)) return null;
  const out: ClientConfigEvent["payload"] = {};
  if (isBoolean(payload.vadEnabled)) out.vadEnabled = payload.vadEnabled;
  if (isString(payload.language)) out.language = payload.language;
  return out;
}

/**
 * Validate one parsed event against the union. Returns the narrowed event, or
 * `null` when the type is unknown (forward compatibility) or malformed.
 */
function validateEvent(
  type: string,
  sessionId: string,
  timestamp: string,
  payload: unknown,
): RealtimeEvent | null {
  const base = { sessionId, timestamp };

  switch (type) {
    case "agent.welcome": {
      const p = parseWelcomePayload(payload);
      return p === null ? null : { ...base, type, payload: p };
    }
    case "agent.message.start": {
      const p = parseMessageStartPayload(payload);
      return p === null ? null : { ...base, type, payload: p };
    }
    case "agent.message.delta": {
      const p = parseMessageDeltaPayload(payload);
      return p === null ? null : { ...base, type, payload: p };
    }
    case "agent.message.done": {
      const p = parseMessageDonePayload(payload);
      return p === null ? null : { ...base, type, payload: p };
    }
    case "transcript.partial": {
      const p = parseTextOnlyPayload(payload);
      return p === null ? null : { ...base, type, payload: p };
    }
    case "transcript.final": {
      const p = parseFinalPayload(payload);
      return p === null ? null : { ...base, type, payload: p };
    }
    case "tool.call": {
      const p = parseToolCallPayload(payload);
      return p === null ? null : { ...base, type, payload: p };
    }
    case "tool.result": {
      const p = parseToolResultPayload(payload);
      return p === null ? null : { ...base, type, payload: p };
    }
    case "tool.error": {
      const p = parseToolErrorPayload(payload);
      return p === null ? null : { ...base, type, payload: p };
    }
    case "state.connected": {
      if (payload !== undefined && !isRecord(payload)) return null;
      return { ...base, type, payload: {} };
    }
    case "state.listening": {
      const p = parseListeningPayload(payload);
      return p === null ? null : { ...base, type, payload: p };
    }
    case "state.speaking": {
      const p = parseActivePayload(payload);
      return p === null ? null : { ...base, type, payload: p };
    }
    case "state.thinking": {
      const p = parseActivePayload(payload);
      return p === null ? null : { ...base, type, payload: p };
    }
    case "error": {
      const p = parseErrorPayload(payload);
      return p === null ? null : { ...base, type, payload: p };
    }
    case "client.ptt.start": {
      if (payload !== undefined && !isRecord(payload)) return null;
      return { ...base, type, payload: {} };
    }
    case "client.ptt.stop": {
      if (payload !== undefined && !isRecord(payload)) return null;
      return { ...base, type, payload: {} };
    }
    case "client.config": {
      const p = parseClientConfigPayload(payload);
      return p === null ? null : { ...base, type, payload: p };
    }
    default:
      // Unknown type â€” forward compatibility. Ignore silently.
      return null;
  }
}

/**
 * Parse a raw inbound data-channel message. Accepts JSON text or the
 * `Uint8Array`/`ArrayBuffer` LiveKit hands to `RoomEvent.DataReceived`.
 *
 * @returns the validated event, or `null` for unknown types (ignored) and
 *          malformed payloads (also ignored â€” the agent is treated as the
 *          source of truth and a broken frame must not take the UI down).
 */
export function parseRealtimeEvent(
  data: string | ArrayBuffer | Uint8Array,
): RealtimeEvent | null {
  let text: string;
  if (typeof data === "string") {
    text = data;
  } else {
    try {
      text = new TextDecoder().decode(data);
    } catch {
      return null;
    }
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }

  if (!isRecord(raw)) return null;
  if (!isString(raw.type) || !isString(raw.sessionId) || !isString(raw.timestamp)) {
    return null;
  }
  return validateEvent(raw.type, raw.sessionId, raw.timestamp, raw.payload);
}

/**
 * Build a client -> agent event envelope. `sessionId` may be empty until the
 * agent announces one via `agent.welcome` / any other event.
 */
export function createClientEvent(
  type: ClientEvent["type"],
  payload: ClientEvent["payload"],
  sessionId: string,
): ClientEvent {
  return {
    type,
    sessionId,
    timestamp: new Date().toISOString(),
    payload,
  } as ClientEvent;
}
