"use client";

import { formatDuration } from "@/lib/format";

interface SessionStatsProps {
  userCount: number;
  agentCount: number;
  toolCount: number;
  errorCount: number;
  sessionDuration: number;
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string | number;
  tone?: "default" | "good" | "bad";
}) {
  const color =
    tone === "good" ? "text-success" : tone === "bad" ? "text-error" : "text-ink-high";
  return (
    <div className="flex items-baseline gap-1.5">
      <span className={`text-[15px] font-semibold tabular-nums ${color}`}>{value}</span>
      <span className="text-[11px] text-ink-faint">{label}</span>
    </div>
  );
}

export function SessionStats({
  userCount,
  agentCount,
  toolCount,
  errorCount,
  sessionDuration,
}: SessionStatsProps) {
  const hasSession = userCount > 0 || agentCount > 0;

  return (
    <section
      className="flex flex-col gap-4 rounded-2xl border border-line bg-graphite-900 p-7 shadow-[0_1px_0_rgba(255,255,255,0.02)_inset,0_16px_40px_-20px_rgba(0,0,0,0.6)]"
      aria-label="Session statistics"
    >
      <h2 className="section-title">Session</h2>

      {!hasSession ? (
        <p className="text-[12px] leading-relaxed text-ink-faint">
          Stats appear once the conversation starts.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-x-7 gap-y-3">
            <Stat label="user turns" value={userCount} />
            <Stat label="agent turns" value={agentCount} />
            <Stat label="tools" value={toolCount} />
            <Stat label="errors" value={errorCount} tone={errorCount > 0 ? "bad" : "good"} />
          </div>
          <div className="flex items-baseline justify-between gap-4 border-t border-line pt-3 text-[13px]">
            <span className="text-ink-low">Elapsed</span>
            <span className="font-mono tabular-nums text-ink-mid">
              {formatDuration(sessionDuration)}
            </span>
          </div>
        </>
      )}
    </section>
  );
}
