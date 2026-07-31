/**
 * Thin, hook-agnostic wrapper around `livekit-client`'s `Room` class.
 *
 * Owns the LiveKit lifecycle: connect with a token, mic publication, data
 * channel send/receive, participant tracking, audio unlock, and connection
 * recovery with exponential backoff when the server drops us.
 *
 * Deliberately NOT built on @livekit/components-react's prebuilt components —
 * the core logic is hand-rolled on the raw `Room` API as specified.
 */

import {
  Room,
  RoomEvent,
  DisconnectReason,
  Track,
  createLocalAudioTrack,
  type LocalAudioTrack,
  type LocalParticipant,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type TrackPublication,
} from "livekit-client";

import {
  createClientEvent,
  parseRealtimeEvent,
  type ClientEvent,
  type RealtimeEvent,
} from "./types";

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export type RoomStatus = "disconnected" | "connecting" | "connected" | "reconnecting" | "error";

export interface ParticipantInfo {
  identity: string;
  name: string;
  isAgent: boolean;
  isLocal: boolean;
}

export interface VoiceRoomCallbacks {
  /** A validated realtime event arrived over the data channel. */
  onEvent: (event: RealtimeEvent) => void;
  /** Connection status changed (includes reconnect attempts and terminal errors). */
  onStatusChange: (status: RoomStatus, detail?: string) => void;
  /** Participant list changed (join/leave/track changes). */
  onParticipantsChange: (participants: ParticipantInfo[]) => void;
  /** Local microphone mute state changed. */
  onMicChange: (enabled: boolean) => void;
  /** A reconnect attempt is starting. */
  onReconnectAttempt?: (attempt: number, maxAttempts: number) => void;
}

export interface VoiceRoomOptions {
  agentName?: string;
  /** Max connect retries after a full disconnect. */
  maxReconnectAttempts?: number;
  /** Base backoff delay in ms; doubled per attempt. */
  reconnectBaseDelayMs?: number;
}

const DEFAULT_MAX_RECONNECT_ATTEMPTS = 4;
const DEFAULT_RECONNECT_BASE_DELAY_MS = 1_000;

/** Reasons after which automatic reconnection is worth trying. */
function isReconnectableReason(reason?: DisconnectReason): boolean {
  // Inverted allowlist: everything except deliberate/terminal reasons is worth
  // retrying, so new protocol reasons stay reconnectable by default.
  switch (reason) {
    case DisconnectReason.CLIENT_INITIATED:
    case DisconnectReason.DUPLICATE_IDENTITY:
    case DisconnectReason.JOIN_FAILURE:
    case DisconnectReason.ROOM_DELETED:
    case DisconnectReason.PARTICIPANT_REMOVED:
      return false;
    default:
      return true;
  }
}

function participantInfo(
  participant: Participant,
  localIdentity: string,
  agentName: string,
): ParticipantInfo {
  const identity = participant.identity;
  const name = participant.name || identity;
  const haystack = `${identity} ${name} ${agentName}`.toLowerCase();
  const isAgent = haystack.includes("agent");
  return { identity, name, isAgent, isLocal: identity === localIdentity };
}

// ---------------------------------------------------------------------------
// The wrapper
// ---------------------------------------------------------------------------

export class VoiceRoom {
  private readonly callbacks: VoiceRoomCallbacks;
  private readonly agentName: string;
  private readonly maxReconnectAttempts: number;
  private readonly reconnectBaseDelayMs: number;

  private room: Room | null = null;
  private micTrack: LocalAudioTrack | null = null;
  private micPublished = false;
  private micDesired = false;

  private status: RoomStatus = "disconnected";
  private userInitiatedDisconnect = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // Connection parameters for reconnection attempts.
  private lastToken: string | null = null;
  private lastUrl: string | null = null;
  private lastRoomName: string | null = null;

  /** Monotonic guard so stale async work never overwrites newer state. */
  private generation = 0;

  constructor(callbacks: VoiceRoomCallbacks, options: VoiceRoomOptions = {}) {
    this.callbacks = callbacks;
    this.agentName = options.agentName ?? "Voice Agent";
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS;
    this.reconnectBaseDelayMs = options.reconnectBaseDelayMs ?? DEFAULT_RECONNECT_BASE_DELAY_MS;
  }

  get currentStatus(): RoomStatus {
    return this.status;
  }

  get isMicrophoneEnabled(): boolean {
    return this.micDesired;
  }

  // -- Lifecycle -----------------------------------------------------------

  async connect(roomName: string, token: string, url: string): Promise<void> {
    this.userInitiatedDisconnect = false;
    this.lastRoomName = roomName;
    this.lastToken = token;
    this.lastUrl = url;

    await this.establishConnection();
  }

  private async establishConnection(): Promise<void> {
    const token = this.lastToken;
    const url = this.lastUrl;
    if (!token || !url) {
      this.fail("Missing connection parameters (call connect first).");
      return;
    }

    const generation = ++this.generation;
    this.clearReconnectTimer();
    this.disposeRoom();
    this.setStatus(this.reconnectAttempt > 0 ? "reconnecting" : "connecting");

    try {
      const room = new Room({
        adaptiveStream: false,
        dynacast: false,
      });
      this.room = room;
      this.attachRoomListeners(room);

      await room.connect(url, token);
      if (generation !== this.generation) return; // superseded

      // Unlock audio playback (browser autoplay policy) — call within the
      // user-gesture chain that triggered connect.
      try {
        await room.startAudio();
      } catch {
        // Non-fatal: some browsers may still allow playback on first remote track.
      }

      this.reconnectAttempt = 0;
      this.emitParticipants();
      this.setStatus("connected");

      // Restore the mic if it was on before a reconnect.
      if (this.micDesired) {
        await this.setMicrophoneEnabled(true);
      }
    } catch (err) {
      if (generation !== this.generation) return;
      const detail = err instanceof Error ? err.message : String(err);
      if (this.reconnectAttempt > 0) {
        this.scheduleReconnect(detail);
      } else {
        this.fail(`Could not join room: ${detail}`);
      }
    }
  }

  async disconnect(): Promise<void> {
    this.userInitiatedDisconnect = true;
    this.generation += 1; // invalidate in-flight reconnect work
    this.clearReconnectTimer();
    this.micDesired = false;
    this.disposeRoom();
    this.setStatus("disconnected");
    this.callbacks.onParticipantsChange([]);
    this.callbacks.onMicChange(false);
  }

  // -- Microphone ----------------------------------------------------------

  /**
   * Enable/disable the local microphone. When enabling, creates and publishes
   * a fresh audio track if needed (the publication survives mute/unmute).
   */
  async setMicrophoneEnabled(enabled: boolean): Promise<void> {
    this.micDesired = enabled;
    const room = this.room;
    const participant = room?.localParticipant;

    if (enabled) {
      if (!this.micTrack) {
        try {
          this.micTrack = await createLocalAudioTrack();
        } catch (err) {
          this.callbacks.onMicChange(false);
          throw new Error(
            `Microphone unavailable: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      await this.micTrack.unmute();
      if (participant && !this.micPublished) {
        await participant.publishTrack(this.micTrack, {
          source: Track.Source.Microphone,
        });
        this.micPublished = true;
      }
    } else if (this.micTrack) {
      await this.micTrack.mute();
    }

    this.callbacks.onMicChange(enabled);
  }

  // -- Data channel --------------------------------------------------------

  /** Publish a `client.*` message to the agent. */
  publishClientMessage(
    type: ClientEvent["type"],
    payload: ClientEvent["payload"],
    sessionId: string,
  ): void {
    const participant = this.room?.localParticipant;
    if (!participant) return;

    const envelope = createClientEvent(type, payload, sessionId);
    const bytes = new TextEncoder().encode(JSON.stringify(envelope));
    void participant.publishData(bytes, { reliable: true }).catch((err: unknown) => {
      // Non-fatal — the agent will notice a missing ptt/config frame itself.
      console.warn("Failed to publish client message:", err);
    });
  }

  // -- Internals -----------------------------------------------------------

  private attachRoomListeners(room: Room): void {
    room
      .on(RoomEvent.DataReceived, this.handleDataReceived)
      .on(RoomEvent.Disconnected, this.handleDisconnected)
      .on(RoomEvent.Reconnecting, this.handleReconnecting)
      .on(RoomEvent.Reconnected, this.handleReconnected)
      .on(RoomEvent.ParticipantConnected, this.handleParticipantsChanged)
      .on(RoomEvent.ParticipantDisconnected, this.handleParticipantsChanged)
      .on(RoomEvent.TrackSubscribed, this.handleTrackSubscribed)
      .on(RoomEvent.TrackUnsubscribed, this.handleParticipantsChanged)
      .on(RoomEvent.LocalTrackPublished, this.handleParticipantsChanged)
      .on(RoomEvent.LocalTrackUnpublished, this.handleParticipantsChanged);
  }

  private readonly handleDataReceived = (
    payload: Uint8Array,
    participant?: RemoteParticipant,
  ): void => {
    // Only the agent speaks; ignore our own echoes.
    if (!participant) return;
    const event = parseRealtimeEvent(payload);
    if (event) this.callbacks.onEvent(event);
  };

  private readonly handleDisconnected = (reason?: DisconnectReason): void => {
    if (this.userInitiatedDisconnect) {
      this.disposeRoom();
      return;
    }
    if (!isReconnectableReason(reason)) {
      this.fail(reason === undefined ? "Disconnected from LiveKit." : `Disconnected (${reason}).`);
      return;
    }
    this.scheduleReconnect(`Connection lost${reason === undefined ? "" : ` (${reason})`}`);
  };

  private readonly handleReconnecting = (): void => {
    this.setStatus("reconnecting");
  };

  private readonly handleReconnected = (): void => {
    this.reconnectAttempt = 0;
    this.setStatus("connected");
    this.emitParticipants();
  };

  private readonly handleParticipantsChanged = (): void => {
    this.emitParticipants();
  };

  private readonly handleTrackSubscribed = (
    track: RemoteTrack,
    _publication: RemoteTrackPublication,
    _participant: RemoteParticipant,
  ): void => {
    // Ensure remote audio is attached for playback. Idempotent — returns the
    // existing element if the SDK already auto-attached it.
    if (track.kind === Track.Kind.Audio) {
      track.attach();
    }
    this.emitParticipants();
  };

  private scheduleReconnect(reason: string): void {
    this.reconnectAttempt += 1;
    if (this.reconnectAttempt > this.maxReconnectAttempts) {
      this.fail(`${reason}. Reconnection failed after ${this.maxReconnectAttempts} attempts.`);
      return;
    }

    const attempt = this.reconnectAttempt;
    this.callbacks.onReconnectAttempt?.(attempt, this.maxReconnectAttempts);
    this.setStatus("reconnecting");

    const delay = this.reconnectBaseDelayMs * 2 ** (attempt - 1);
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      void this.establishConnection();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private emitParticipants(): void {
    const room = this.room;
    if (!room || room.state === "disconnected") return;
    const localIdentity = room.localParticipant.identity;
    const participants: ParticipantInfo[] = [];
    for (const participant of room.remoteParticipants.values()) {
      participants.push(participantInfo(participant, localIdentity, this.agentName));
    }
    participants.push(participantInfo(room.localParticipant, localIdentity, this.agentName));
    participants.sort((a, b) => Number(a.isAgent) - Number(b.isAgent) || a.name.localeCompare(b.name));
    this.callbacks.onParticipantsChange(participants);
  }

  private disposeRoom(): void {
    this.clearReconnectTimer();
    const room = this.room;
    this.room = null;
    this.micPublished = false;
    if (this.micTrack) {
      this.micTrack.stop();
      this.micTrack = null;
    }
    if (room) {
      room.removeAllListeners();
      void room.disconnect().catch(() => undefined);
    }
  }

  private setStatus(status: RoomStatus, detail?: string): void {
    if (this.status === status) return;
    this.status = status;
    this.callbacks.onStatusChange(status, detail);
  }

  private fail(detail: string): void {
    this.generation += 1;
    this.disposeRoom();
    this.callbacks.onMicChange(false);
    this.status = "error";
    // Emit unconditionally — a second error after one already surfaced must
    // still reach the UI with the fresh detail.
    this.callbacks.onStatusChange("error", detail);
  }
}

// Kept for consumers that need to inspect track kinds without re-importing.
export type { LocalParticipant, TrackPublication };
