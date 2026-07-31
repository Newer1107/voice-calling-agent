"use client";

import { Spinner } from "@/components/Spinner";
import type { RoomStatus } from "@/lib/voice-room";

interface ConnectionPanelProps {
  status: RoomStatus;
  errorDetail: string | null;
  livekitUrl: string | undefined;
  onConnect: () => void;
  onDisconnect: () => void;
}

const STATUS_META: Record<RoomStatus, { label: string; classes: string; dot: string }> = {
  disconnected: {
    label: "Disconnected",
    classes: "border-slate-600/60 bg-slate-800/60 text-slate-300",
    dot: "bg-slate-400",
  },
  connecting: {
    label: "Connecting…",
    classes: "border-amber-500/40 bg-amber-500/10 text-amber-300",
    dot: "bg-amber-400 animate-pulse-soft",
  },
  connected: {
    label: "Connected",
    classes: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
    dot: "bg-emerald-400",
  },
  reconnecting: {
    label: "Reconnecting…",
    classes: "border-amber-500/40 bg-amber-500/10 text-amber-300",
    dot: "bg-amber-400 animate-pulse-soft",
  },
  error: {
    label: "Error",
    classes: "border-rose-500/50 bg-rose-500/10 text-rose-300",
    dot: "bg-rose-400",
  },
};

export function ConnectionPanel({
  status,
  errorDetail,
  livekitUrl,
  onConnect,
  onDisconnect,
}: ConnectionPanelProps) {
  const busy = status === "connecting" || status === "reconnecting";
  const connected = status === "connected";
  const meta = STATUS_META[status];

  return (
    <section className="panel" aria-label="Connection">
      <div className="panel-header">
        <h2 className="panel-title">Connection</h2>
        <span className={`chip ${meta.classes}`}>
          <span className={`chip-dot ${meta.dot}`} aria-hidden="true" />
          {meta.label}
        </span>
      </div>

      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          {connected || status === "reconnecting" ? (
            <button type="button" onClick={onDisconnect} className="btn-danger flex-1">
              {status === "reconnecting" ? "Cancel" : "Disconnect"}
            </button>
          ) : (
            <button
              type="button"
              onClick={onConnect}
              disabled={busy}
              className="btn-primary flex-1"
            >
              {busy ? (
                <>
                  <Spinner className="h-4 w-4" />
                  Connecting…
                </>
              ) : (
                "Connect"
              )}
            </button>
          )}
        </div>

        <dl className="flex flex-col gap-1 text-xs text-slate-400">
          <div className="flex gap-2">
            <dt className="w-24 flex-none text-slate-500">LiveKit URL</dt>
            <dd className="min-w-0 font-mono break-all text-slate-300">
              {livekitUrl ?? "unset (see .env)"}
            </dd>
          </div>
          {errorDetail && (
            <div className="flex gap-2">
              <dt className="w-24 flex-none text-slate-500">Last error</dt>
              <dd className="min-w-0 break-words text-rose-300">{errorDetail}</dd>
            </div>
          )}
        </dl>
      </div>
    </section>
  );
}
