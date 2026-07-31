"use client";

import { useMemo } from "react";

import { AgentState } from "@/components/AgentState";
import { ConnectionPanel } from "@/components/ConnectionPanel";
import { ControlsPanel } from "@/components/ControlsPanel";
import { ErrorToasts } from "@/components/ErrorToasts";
import { HistoryPanel } from "@/components/HistoryPanel";
import { MemorySection } from "@/components/MemorySection";
import { SessionStats } from "@/components/SessionStats";
import { ToolActivity } from "@/components/ToolActivity";
import { TranscriptPanel } from "@/components/TranscriptPanel";
import { useVoiceAgent } from "@/hooks/use-voice-agent";
import { useSessionDuration } from "@/hooks/use-session-duration";
import { formatDuration, formatLatency } from "@/lib/format";
import type { RoomStatus } from "@/lib/voice-room";

const STATUS_LABEL: Record<RoomStatus, string> = {
  disconnected: "Disconnected",
  connecting: "Connecting",
  connected: "Connected",
  reconnecting: "Reconnecting",
  error: "Error",
};

function StatusDot({ status }: { status: RoomStatus }) {
  const color =
    status === "connected"
      ? "bg-success"
      : status === "error"
        ? "bg-error"
        : status === "disconnected"
          ? "bg-ink-faint"
          : "bg-warning animate-pulse-soft";
  return <span className={`h-2 w-2 rounded-full ${color}`} aria-hidden="true" />;
}

function DisconnectIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M8.4 4.9a8 8 0 1 0 7.2 0M12 2v9"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function VoiceConsole() {
  const agent = useVoiceAgent();
  const sessionDuration = useSessionDuration(agent.connected);

  // Latest completed tool round-trip — an honest, client-derived "latency".
  const toolLatency = useMemo(() => {
    const done = agent.toolActivity.find((t) => t.status !== "running");
    return done?.durationMs;
  }, [agent.toolActivity]);

  return (
    <div className="flex min-h-dvh flex-col">
      <ErrorToasts errors={agent.errors} onDismiss={agent.dismissError} />

      <header className="flex flex-wrap items-start justify-between gap-x-8 gap-y-6 px-6 pt-10 sm:px-10 lg:px-14">
        <div className="max-w-xl">
          <h1 className="text-[32px] font-bold leading-tight tracking-[-0.02em] text-ink-high">
            Voice Agent Console
          </h1>
          <p className="mt-2.5 text-[15px] leading-relaxed text-ink-low">
            Live conversation with the n8n + Ollama voice agent. Mic audio
            streams over LiveKit; transcripts and tool activity return in real
            time.
          </p>
        </div>

        <div className="flex items-center gap-5 pt-1.5" role="status">
          <span className="flex items-center gap-2.5 text-[13px] font-medium text-ink-mid">
            <StatusDot status={agent.status} />
            {STATUS_LABEL[agent.status]}
          </span>
          {agent.connected && toolLatency !== undefined && (
            <span className="hidden items-baseline gap-1.5 text-[12px] text-ink-faint sm:flex">
              <span>tool</span>
              <span className="font-mono tabular-nums text-ink-mid">
                {formatLatency(toolLatency)}
              </span>
            </span>
          )}
          {agent.connected && (
            <span className="hidden font-mono text-[12px] tabular-nums text-ink-mid sm:inline">
              {formatDuration(sessionDuration)}
            </span>
          )}
          {(agent.connected || agent.status === "reconnecting") && (
            <button
              type="button"
              onClick={agent.disconnect}
              aria-label="Disconnect"
              title="Disconnect"
              className="icon-btn"
            >
              <DisconnectIcon />
            </button>
          )}
        </div>
      </header>

      <div className="grid flex-1 items-start gap-x-12 gap-y-14 px-6 pb-16 pt-12 sm:px-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)] lg:px-14">
        <div className="min-w-0">
          <TranscriptPanel
            userTranscript={agent.userTranscript}
            aiMessages={agent.aiMessages}
            agentName={agent.agentName ?? "Voice Agent"}
            connected={agent.connected}
            thinking={agent.thinking}
          />
        </div>

        <aside className="flex min-w-0 flex-col gap-12" aria-label="Assistant activity">
          <ConnectionPanel
            status={agent.status}
            errorDetail={agent.errorDetail}
            livekitUrl={agent.livekitUrl}
            sessionId={agent.sessionId}
            sessionDuration={sessionDuration}
            micEnabled={agent.micEnabled}
            onConnect={agent.connect}
            onDisconnect={agent.disconnect}
          />
          <ControlsPanel
            connected={agent.connected}
            listening={agent.listening.active}
            speaking={agent.speaking}
            thinking={agent.thinking}
            vadEnabled={agent.vadEnabled}
            pttHeld={agent.pttHeld}
            micEnabled={agent.micEnabled}
            agentName={agent.agentName ?? "Voice Agent"}
            onStartPtt={agent.startPushToTalk}
            onStopPtt={agent.stopPushToTalk}
            onToggleVad={agent.toggleVad}
          />
          <AgentState
            listening={agent.listening.active}
            speaking={agent.speaking}
            thinking={agent.thinking}
          />
          <ToolActivity items={agent.toolActivity} />
          <MemorySection
            userTranscript={agent.userTranscript}
            aiMessages={agent.aiMessages}
            history={agent.conversationHistory}
          />
          <SessionStats
            userCount={agent.userTranscript.filter((t) => t.final).length}
            agentCount={agent.aiMessages.filter((m) => m.done).length}
            toolCount={agent.toolActivity.length}
            errorCount={agent.errors.length}
            sessionDuration={sessionDuration}
          />
          <HistoryPanel entries={agent.conversationHistory} sessionId={agent.sessionId} />
        </aside>
      </div>
    </div>
  );
}
