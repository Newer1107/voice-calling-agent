"use client";

import { formatDuration, formatLatency } from "@/lib/format";
import type { RoomStatus } from "@/lib/voice-room";

interface ConnectionPanelProps {
  status: RoomStatus;
  errorDetail: string | null;
  livekitUrl: string | undefined;
  sessionId: string | null;
  sessionDuration: number;
  micEnabled: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}

function Dot({ className }: { className?: string }) {
  return <span className={`h-2 w-2 rounded-full ${className}`} aria-hidden="true" />;
}

function CopyButton({ text }: { text: string }) {
  return (
    <button
      type="button"
      onClick={() => navigator.clipboard.writeText(text)}
      aria-label="Copy session ID"
      title="Copy"
      className="icon-btn !h-5 !w-5 text-ink-faint"
    >
      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M8 8h12v12H8V8Zm0 0V4h12v4M4 4h4"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 text-[13px]">
      <dt className="text-ink-low">{label}</dt>
      <dd className="flex min-w-0 items-center gap-1.5 text-ink-mid">{children}</dd>
    </div>
  );
}

export function ConnectionPanel({
  status,
  errorDetail,
  livekitUrl,
  sessionId,
  sessionDuration,
  micEnabled,
  onConnect,
  onDisconnect,
}: ConnectionPanelProps) {
  const connected = status === "connected";
  const busy = status === "connecting" || status === "reconnecting";

  const tone =
    status === "connected"
      ? { label: "Connected", dot: "bg-success" }
      : status === "error"
        ? { label: "Error", dot: "bg-error" }
        : status === "connecting" || status === "reconnecting"
          ? { label: status === "connecting" ? "Connecting" : "Reconnecting", dot: "bg-warning animate-pulse-soft" }
          : { label: "Disconnected", dot: "bg-ink-faint" };

  return (
    <section
      className="flex flex-col gap-5 rounded-2xl border border-line bg-graphite-900 p-7 shadow-[0_1px_0_rgba(255,255,255,0.02)_inset,0_16px_40px_-20px_rgba(0,0,0,0.6)]"
      aria-label="Connection status"
    >
      <div className="flex items-center justify-between">
        <h2 className="section-title">Connection</h2>
        <span className="flex items-center gap-2 text-[12px] font-medium text-ink-mid">
          <Dot className={tone.dot} />
          {tone.label}
        </span>
      </div>

      {status === "error" && errorDetail && (
        <p className="rounded-lg border border-line bg-graphite-850 px-3 py-2 text-[12px] leading-relaxed text-error">
          {errorDetail}
        </p>
      )}

      <dl className="flex flex-col gap-3">
        <Row label="LiveKit URL">
          <span className="truncate font-mono text-[12px]">{livekitUrl ?? "—"}</span>
        </Row>
        {connected && (
          <>
            <Row label="Session ID">
              <span className="truncate font-mono text-[12px]">{sessionId ?? "—"}</span>
              {sessionId && <CopyButton text={sessionId} />}
            </Row>
            <Row label="Session time">
              <span className="font-mono tabular-nums">{formatDuration(sessionDuration)}</span>
            </Row>
            <Row label="Microphone">
              <span className={micEnabled ? "text-success" : "text-error"}>
                {micEnabled ? "Enabled" : "Blocked"}
              </span>
            </Row>
          </>
        )}
      </dl>

      <div className="mt-1 flex gap-3">
        {!connected && (
          <button type="button" onClick={onConnect} disabled={busy} className="btn-accent flex-1">
            {busy ? "Connecting…" : "Connect"}
          </button>
        )}
        {connected && (
          <button type="button" onClick={onDisconnect} className="btn-ghost flex-1">
            Disconnect
          </button>
        )}
      </div>
    </section>
  );
}
