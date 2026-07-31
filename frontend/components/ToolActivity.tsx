"use client";

import type { ToolActivityItem, ToolStatus } from "@/hooks/use-voice-agent";

interface ToolActivityProps {
  items: ToolActivityItem[];
}

const STATUS_META: Record<ToolStatus, { label: string; classes: string; dot: string }> = {
  running: {
    label: "Running",
    classes: "border-amber-500/40 bg-amber-500/10 text-amber-300",
    dot: "bg-amber-400 animate-pulse-soft",
  },
  ok: {
    label: "OK",
    classes: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
    dot: "bg-emerald-400",
  },
  error: {
    label: "Error",
    classes: "border-rose-500/40 bg-rose-500/10 text-rose-300",
    dot: "bg-rose-400",
  },
};

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function ToolActivity({ items }: ToolActivityProps) {
  return (
    <section className="panel" aria-label="Tool activity">
      <div className="panel-header">
        <h2 className="panel-title">Tool activity</h2>
        {items.some((i) => i.status === "running") && (
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-amber-300">
            <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-amber-400" />
            Calling n8n…
          </span>
        )}
      </div>

      <div className="max-h-56 overflow-y-auto p-4">
        {items.length === 0 ? (
          <p className="text-sm text-slate-500">
            No tool activity yet. When the agent calls an n8n webhook, it shows up here.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((item) => {
              const meta = STATUS_META[item.status];
              return (
                <li
                  key={item.id}
                  className="rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate font-mono text-xs font-semibold text-slate-200">
                      {item.tool}
                    </span>
                    <span className={`chip ${meta.classes} px-2 py-0.5 text-[10px]`}>
                      <span className={`chip-dot ${meta.dot}`} aria-hidden="true" />
                      {meta.label}
                    </span>
                  </div>
                  {item.argsSummary && (
                    <p className="mt-1 truncate font-mono text-[10px] text-slate-500">
                      {item.argsSummary}
                    </p>
                  )}
                  {item.detail && (
                    <p
                      className={`mt-1 line-clamp-2 text-[11px] leading-snug ${
                        item.status === "error" ? "text-rose-300" : "text-slate-400"
                      }`}
                    >
                      {item.detail}
                    </p>
                  )}
                  <p className="mt-1 text-[10px] text-slate-600">{formatTime(item.timestamp)}</p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
