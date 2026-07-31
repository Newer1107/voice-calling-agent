"use client";

import { useState } from "react";

import type { ToolActivityItem, ToolStatus } from "@/hooks/use-voice-agent";
import { formatLatency, formatTime } from "@/lib/format";

interface ToolActivityProps {
  items: ToolActivityItem[];
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-3.5 w-3.5 flex-none text-ink-faint transition-transform duration-150 ${open ? "rotate-90" : ""}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StatusIcon({ status }: { status: ToolStatus }) {
  if (status === "running") {
    return (
      <span className="h-3.5 w-3.5 flex-none" aria-label="Running" role="status">
        <svg className="h-full w-full animate-spin text-ink-mid" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.5" />
          <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      </span>
    );
  }
  if (status === "ok") {
    return (
      <svg className="h-3.5 w-3.5 flex-none text-success" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg className="h-3.5 w-3.5 flex-none text-error" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function ToolCard({ item }: { item: ToolActivityItem }) {
  const [open, setOpen] = useState(false);
  const done = item.status !== "running";

  return (
    <div
      className={`animate-fade-in rounded-lg border px-3.5 py-3 transition-opacity duration-200 ${
        done ? "border-line bg-graphite-850 opacity-100" : "border-accent/30 bg-accent/[0.06]"
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={!done}
        aria-expanded={open}
        className="flex w-full items-center gap-3 text-left disabled:cursor-default"
      >
        <StatusIcon status={item.status} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-ink-high">
            {item.tool}
          </span>
          <span className="mt-0.5 block truncate font-mono text-[11px] text-ink-faint">
            {item.argsSummary}
          </span>
        </span>
        {done && item.durationMs !== undefined && (
          <span className="flex-none font-mono text-[11px] tabular-nums text-ink-low">
            {formatLatency(item.durationMs)}
          </span>
        )}
        {done && <Chevron open={open} />}
      </button>

      {done && open && item.detail && (
        <div className="mt-2.5 border-t border-line pt-2.5">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
            {item.status === "ok" ? "Output" : "Error"}
          </p>
          <p
            className={`whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed ${
              item.status === "ok" ? "text-ink-mid" : "text-error"
            }`}
          >
            {item.detail}
          </p>
        </div>
      )}
    </div>
  );
}

export function ToolActivity({ items }: ToolActivityProps) {
  return (
    <section
      className="flex flex-col gap-4 rounded-2xl border border-line bg-graphite-900 p-7 shadow-[0_1px_0_rgba(255,255,255,0.02)_inset,0_16px_40px_-20px_rgba(0,0,0,0.6)]"
      aria-label="Tool executions"
    >
      <div className="flex items-center justify-between">
        <h2 className="section-title">Tool Executions</h2>
        <span className="text-[12px] text-ink-faint">
          {items.filter((t) => t.status === "running").length > 0 ? "Running…" : `${items.length} total`}
        </span>
      </div>

      {items.length === 0 ? (
        <p className="text-[12px] leading-relaxed text-ink-faint">
          No tools called yet. The agent invokes tools (web search, memory,
          actions) while answering.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((item) => (
            <ToolCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}
