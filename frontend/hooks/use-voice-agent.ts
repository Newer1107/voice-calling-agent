"use client";

/**
 * The orchestrating hook: wires the LiveKit `VoiceRoom` into React state and
 * renders every realtime event from the data channel as UI state (transcripts,
 * indicators, tool activity, error toasts).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AGENT_NAME, getHistory, getToken, LIVEKIT_URL } from "@/lib/agent-api";
import type { RealtimeEvent } from "@/lib/types";
import { VoiceRoom, type ParticipantInfo, type RoomStatus } from "@/lib/voice-room";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface UserTurn {
  id: string;
  text: string;
  final: boolean;
  timestamp: string;
}

export interface AiMessage {
  id: string;
  text: string;
  done: boolean;
  timestamp: string;
}

export interface ConversationEntry {
  id: string;
  role: "user" | "agent";
  text: string;
  timestamp: string;
  source: "live" | "history";
}

export type ToolStatus = "running" | "ok" | "error";

export interface ToolActivityItem {
  id: string;
  tool: string;
  argsSummary: string;
  status: ToolStatus;
  detail?: string;
  timestamp: string;
  /** Round-trip latency computed client-side from call -> result timestamps. */
  durationMs?: number;
}

export interface ErrorToast {
  id: string;
  code: string;
  message: string;
  fatal: boolean;
  timestamp: string;
}

export interface ListenState {
  active: boolean;
  source: "vad" | "ptt" | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function generateRoomName(): string {
  return `voice-${Date.now().toString(36)}-${uuid().slice(0, 8)}`;
}

function formatArgsSummary(args: Record<string, unknown>): string {
  try {
    const json = JSON.stringify(args);
    return json.length > 120 ? `${json.slice(0, 117)}...` : json;
  } catch {
    return "{...}";
  }
}

function computeDurationMs(callTimestamp: string, resultTimestamp: string): number | undefined {
  const start = new Date(callTimestamp).getTime();
  const end = new Date(resultTimestamp).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return undefined;
  return end - start;
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

export function useVoiceAgent() {
  const [status, setStatus] = useState<RoomStatus>("disconnected");
  const [errorDetail, setErrorDetail] = useState<string | null>(null);

  const [agentListening, setAgentListening] = useState<ListenState>({
    active: false,
    source: null,
  });
  const [speaking, setSpeaking] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [pttHeld, setPttHeld] = useState(false);
  // Push-to-talk is the default input mode: the agent only listens while the
  // button/Space is held. VAD can be enabled for hands-free conversation.
  const [vadEnabled, setVadEnabled] = useState(false);

  const [micEnabled, setMicEnabled] = useState(false);
  const [participants, setParticipants] = useState<ParticipantInfo[]>([]);

  const [userTranscript, setUserTranscript] = useState<UserTurn[]>([]);
  const [aiMessages, setAiMessages] = useState<AiMessage[]>([]);
  const [historyMessages, setHistoryMessages] = useState<ConversationEntry[]>([]);

  const [toolActivity, setToolActivity] = useState<ToolActivityItem[]>([]);
  const [errors, setErrors] = useState<ErrorToast[]>([]);

  const [sessionId, setSessionId] = useState<string>("");

  const roomRef = useRef<VoiceRoom | null>(null);
  const connectingRef = useRef(false);
  const historyFetchedRef = useRef<Set<string>>(new Set());
  const sessionIdRef = useRef<string>("");
  const vadEnabledRef = useRef(true);
  const errorTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // LiveKit bills per connected participant-minute, so a tab left connected
  // but idle leaks billable minutes. Disconnect after IDLE_DISCONNECT_MS of
  // no activity (transcripts, speaking/thinking, PTT, VAD toggles).
  const lastActivityRef = useRef<number>(Date.now());
  const IDLE_DISCONNECT_MS = 10 * 60_000;

  // Keep a ref in sync so `connect` (memoized on [status]) sees the latest VAD pref.
  useEffect(() => {
    vadEnabledRef.current = vadEnabled;
  }, [vadEnabled]);

  const markActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
  }, []);

  const dismissError = useCallback((id: string) => {
    setErrors((prev) => prev.filter((e) => e.id !== id));
    const timer = errorTimersRef.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      errorTimersRef.current.delete(id);
    }
  }, []);

  const pushError = useCallback(
    (code: string, message: string, recoverable: boolean) => {
      const toast: ErrorToast = {
        id: uuid(),
        code,
        message,
        fatal: !recoverable,
        timestamp: new Date().toISOString(),
      };
      setErrors((prev) => [...prev.slice(-4), toast]);
      if (recoverable) {
        const timer = setTimeout(() => dismissError(toast.id), 7_000);
        errorTimersRef.current.set(toast.id, timer);
      }
    },
    [dismissError],
  );

  // When the user barge-ins, the agent cuts its reply short and never emits
  // message.done for it — mark any streaming AI message as done so the
  // transcript doesn't sit on an eternal typing indicator.
  const finalizeIncompleteAi = useCallback(() => {
    setAiMessages((prev) =>
      prev.some((m) => !m.done) ? prev.map((m) => (m.done ? m : { ...m, done: true })) : prev,
    );
  }, []);

  // Learn the session id from the first inbound event; fetch past history once.
  const learnSession = useCallback((sid: string) => {
    if (!sid || sessionIdRef.current === sid) return;
    sessionIdRef.current = sid;
    setSessionId(sid);

    if (historyFetchedRef.current.has(sid)) return;
    historyFetchedRef.current.add(sid);
    void getHistory(sid).then((history) => {
      if (!history) return;
      const entries: ConversationEntry[] = history.messages
        .filter((m) => m.role !== "tool")
        .filter((m) => (m.content ?? m.text ?? "").trim().length > 0)
        .map((m, i) => ({
          id: `history-${sid}-${i}`,
          role: m.role === "user" ? "user" : "agent",
          text: m.content ?? m.text ?? "",
          timestamp: m.createdAt ?? m.timestamp ?? "",
          source: "history",
        }));
      setHistoryMessages((prev) => [...prev, ...entries]);
    });
  }, []);

  const handleEvent = useCallback(
    (event: RealtimeEvent) => {
      lastActivityRef.current = Date.now();
      learnSession(event.sessionId);

      switch (event.type) {
        case "agent.welcome": {
          const id = event.payload.sessionId ?? uuid();
          const text = event.payload.text.trim();
          if (text) {
            const messageId = `welcome-${id}`;
            setAiMessages((prev) =>
              prev.some((m) => m.id === messageId)
                ? prev
                : [...prev, { id: messageId, text, done: true, timestamp: event.timestamp }],
            );
          }
          break;
        }
        case "agent.message.start": {
          const id = event.payload.messageId ?? uuid();
          setAiMessages((prev) => {
            if (prev.some((m) => m.id === id)) return prev;
            return [...prev, { id, text: "", done: false, timestamp: event.timestamp }];
          });
          break;
        }
        case "agent.message.delta": {
          const { messageId, text } = event.payload;
          setAiMessages((prev) => {
            const index = prev.findIndex((m) => m.id === messageId);
            if (index === -1) {
              return [...prev, { id: messageId, text, done: false, timestamp: event.timestamp }];
            }
            const next = prev.slice();
            const current = next[index];
            if (current) next[index] = { ...current, text: current.text + text };
            return next;
          });
          break;
        }
        case "agent.message.done": {
          const { messageId, text } = event.payload;
          setAiMessages((prev) => {
            const index = prev.findIndex((m) => m.id === messageId);
            if (index === -1) {
              return [...prev, { id: messageId, text, done: true, timestamp: event.timestamp }];
            }
            const next = prev.slice();
            const current = next[index];
            if (current) next[index] = { ...current, text, done: true };
            return next;
          });
          break;
        }
        case "transcript.partial": {
          const text = event.payload.text;
          finalizeIncompleteAi();
          setUserTranscript((prev) => {
            const last = prev[prev.length - 1];
            if (last && !last.final) {
              const next = prev.slice();
              next[next.length - 1] = { ...last, text };
              return next;
            }
            return [...prev, { id: uuid(), text, final: false, timestamp: event.timestamp }];
          });
          break;
        }
        case "transcript.final": {
          const text = event.payload.text;
          finalizeIncompleteAi();
          if (!text.trim()) break;
          setUserTranscript((prev) => {
            const last = prev[prev.length - 1];
            if (last && !last.final) {
              const next = prev.slice();
              next[next.length - 1] = {
                ...last,
                text,
                final: true,
                timestamp: event.timestamp,
              };
              return next;
            }
            return [...prev, { id: uuid(), text, final: true, timestamp: event.timestamp }];
          });
          break;
        }
        case "tool.call": {
          setToolActivity((prev) => [
            {
              id: uuid(),
              tool: event.payload.tool,
              argsSummary: formatArgsSummary(event.payload.arguments),
              status: "running",
              timestamp: event.timestamp,
            },
            ...prev.slice(0, 49),
          ]);
          break;
        }
        case "tool.result": {
          const { tool, ok, summary } = event.payload;
          setToolActivity((prev) => {
            const index = prev.findIndex((t) => t.tool === tool && t.status === "running");
            if (index === -1) {
              return [
                {
                  id: uuid(),
                  tool,
                  argsSummary: "",
                  status: ok ? "ok" : "error",
                  detail: summary,
                  timestamp: event.timestamp,
                },
                ...prev.slice(0, 49),
              ];
            }
            const next = prev.slice();
            const item = next[index];
            if (item)
              next[index] = {
                ...item,
                status: ok ? "ok" : "error",
                detail: summary,
                durationMs: computeDurationMs(item.timestamp, event.timestamp),
              };
            return next;
          });
          break;
        }
        case "tool.error": {
          const { tool, message } = event.payload;
          setToolActivity((prev) => {
            const index = prev.findIndex((t) => t.tool === tool && t.status === "running");
            if (index === -1) {
              return [
                {
                  id: uuid(),
                  tool,
                  argsSummary: "",
                  status: "error",
                  detail: message,
                  timestamp: event.timestamp,
                },
                ...prev.slice(0, 49),
              ];
            }
            const next = prev.slice();
            const item = next[index];
            if (item)
              next[index] = {
                ...item,
                status: "error",
                detail: message,
                durationMs: computeDurationMs(item.timestamp, event.timestamp),
              };
            return next;
          });
          break;
        }
        case "state.connected":
          // Agent pipeline is ready. The pre-connect client.config can be
          // dropped (the agent's inbound loop isn't up yet), so (re)apply the
          // VAD preference now that the session exists.
          if (!vadEnabledRef.current) {
            roomRef.current?.publishClientMessage(
              "client.config",
              { vadEnabled: false },
              event.sessionId,
            );
          }
          break;
        case "state.listening": {
          setAgentListening({
            active: event.payload.active,
            source: event.payload.source ?? null,
          });
          break;
        }
        case "state.speaking":
          setSpeaking(event.payload.active);
          break;
        case "state.thinking":
          setThinking(event.payload.active);
          break;
        case "error": {
          const { code, message, recoverable = true } = event.payload;
          pushError(code, message, recoverable);
          if (!recoverable) {
            setStatus("error");
            setErrorDetail(message);
          }
          break;
        }
        case "client.ptt.start":
        case "client.ptt.stop":
        case "client.config":
          // Our own outbound frames echo — nothing to render.
          break;
      }
    },
    [learnSession, pushError, finalizeIncompleteAi],
  );

  const handleStatusChange = useCallback(
    (next: RoomStatus, detail?: string) => {
      setStatus(next);
      if (next === "error") {
        setErrorDetail(detail ?? "Connection error.");
        pushError("connection", detail ?? "Connection lost.", false);
      } else if (next === "connected") {
        setErrorDetail(null);
      }
    },
    [pushError],
  );

  // Build the VoiceRoom callbacks once; they only use functional setState, so
  // no stale closures regardless of when the room is created.
  const callbacks = useMemo(
    () => ({
      onEvent: handleEvent,
      onStatusChange: handleStatusChange,
      onParticipantsChange: (next: ParticipantInfo[]) => setParticipants(next),
      onMicChange: (enabled: boolean) => setMicEnabled(enabled),
      onReconnectAttempt: (attempt: number, maxAttempts: number) => {
        pushError(
          "reconnecting",
          `Connection lost — reconnecting (attempt ${attempt}/${maxAttempts})…`,
          true,
        );
      },
    }),
    [handleEvent, handleStatusChange, pushError],
  );

  const resetConversation = useCallback(() => {
    setUserTranscript([]);
    setAiMessages([]);
    setHistoryMessages([]);
    setToolActivity([]);
    setAgentListening({ active: false, source: null });
    setSpeaking(false);
    setThinking(false);
    setPttHeld(false);
    sessionIdRef.current = "";
    setSessionId("");
  }, []);

  const connect = useCallback(async () => {
    if (connectingRef.current) return;
    if (status !== "disconnected" && status !== "error") return;

    connectingRef.current = true;
    lastActivityRef.current = Date.now();
    resetConversation();
    setStatus("connecting");

    let token;
    let roomName;
    let identity;
    try {
      roomName = generateRoomName();
      identity = `web-${roomName}`;
      token = await getToken(roomName, identity);
    } catch (err) {
      connectingRef.current = false;
      setStatus("error");
      const message = err instanceof Error ? err.message : String(err);
      setErrorDetail(message);
      pushError("token_failed", message, true);
      return;
    }

    const room = new VoiceRoom(callbacks, { agentName: AGENT_NAME });
    roomRef.current?.disconnect().catch(() => undefined);
    roomRef.current = room;

    try {
      await room.connect(roomName, token.token, token.url);
      await room.setMicrophoneEnabled(true); // publish the mic track once connected
      if (!vadEnabledRef.current) {
        room.publishClientMessage("client.config", { vadEnabled: false }, "");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      pushError("join_failed", `Could not join room: ${message}`, true);
    } finally {
      connectingRef.current = false;
    }
  }, [callbacks, pushError, resetConversation, status]);

  const disconnect = useCallback(async () => {
    await roomRef.current?.disconnect();
    roomRef.current = null;
    setPttHeld(false);
    setMicEnabled(false);
  }, []);

  const startPushToTalk = useCallback(() => {
    if (status !== "connected") return;
    lastActivityRef.current = Date.now();
    finalizeIncompleteAi();
    setPttHeld(true);
    roomRef.current?.publishClientMessage("client.ptt.start", {}, sessionIdRef.current);
  }, [status, finalizeIncompleteAi]);

  const stopPushToTalk = useCallback(() => {
    if (!pttHeld) return;
    lastActivityRef.current = Date.now();
    setPttHeld(false);
    roomRef.current?.publishClientMessage("client.ptt.stop", {}, sessionIdRef.current);
  }, [pttHeld]);

  const toggleVad = useCallback(() => {
    const enabled = !vadEnabled;
    lastActivityRef.current = Date.now();
    setVadEnabled(enabled);
    roomRef.current?.publishClientMessage(
      "client.config",
      { vadEnabled: enabled },
      sessionIdRef.current,
    );
  }, [vadEnabled]);

  // Release mic + timers on unmount.
  useEffect(() => {
    const timers = errorTimersRef.current;
    return () => {
      void roomRef.current?.disconnect();
      roomRef.current = null;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  // Keep mic mute state in sync when a (re)connect publishes/unpublishes.
  const connected = status === "connected";

  // Idle watchdog: checks every 30s while connected and disconnects when the
  // conversation has been silent for the idle window (prevents billable
  // participant-minutes leaking from a tab left open overnight).
  useEffect(() => {
    if (!connected) return;
    const id = setInterval(() => {
      if (Date.now() - lastActivityRef.current > IDLE_DISCONNECT_MS) {
        void roomRef.current?.disconnect();
        pushError("idle_timeout", "Disconnected after 10 minutes of inactivity.", true);
      }
    }, 30_000);
    return () => clearInterval(id);
  }, [connected, pushError]);

  const effectiveListening: ListenState = pttHeld
    ? { active: true, source: "ptt" }
    : agentListening;

  const conversationHistory = useMemo<ConversationEntry[]>(() => {
    const current: ConversationEntry[] = [
      ...userTranscript
        .filter((t) => t.final)
        .map((t) => ({
          id: t.id,
          role: "user" as const,
          text: t.text,
          timestamp: t.timestamp,
          source: "live" as const,
        })),
      ...aiMessages
        .filter((m) => m.done && m.text.trim().length > 0)
        .map((m) => ({
          id: m.id,
          role: "agent" as const,
          text: m.text,
          timestamp: m.timestamp,
          source: "live" as const,
        })),
    ];
    current.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return [...historyMessages, ...current];
  }, [historyMessages, userTranscript, aiMessages]);

  const agentParticipants = useMemo(
    () => participants.filter((p) => p.isAgent && !p.isLocal),
    [participants],
  );

  return {
    // connection
    status,
    errorDetail,
    connected,
    participants,
    agentParticipants,
    agentName: AGENT_NAME,
    // indicators
    listening: effectiveListening,
    speaking,
    thinking,
    vadEnabled,
    micEnabled,
    pttHeld,
    // transcript + history
    userTranscript,
    aiMessages,
    conversationHistory,
    // tool + errors
    toolActivity,
    errors,
    // actions
    connect,
    disconnect,
    startPushToTalk,
    stopPushToTalk,
    toggleVad,
    dismissError,
    // misc
    sessionId,
    livekitUrl: LIVEKIT_URL,
  };
}

export type VoiceAgent = ReturnType<typeof useVoiceAgent>;
