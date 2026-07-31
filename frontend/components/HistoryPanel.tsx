"use client";

import { useState } from "react";

import type { ConversationEntry } from "@/hooks/use-voice-agent";
import { formatTime } from "@/lib/format";

interface HistoryPanelProps {
  entries: ConversationEntry[];
  sessionId: string | null;
}

const ROLE_LABEL: Record<ConversationEntry["role"], string> = {
  user: "You",
  agent: "Assistant",
};

export function HistoryPanel({ entries, sessionId }: HistoryPanelProps) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <section
      className="flex flex-col gap-4 rounded-2xl border border-line bg-graphite-900 p-7 shadow-[0_1px_0_rgba(255,255,255,0.02)_inset,0_16px_40px_-20px_rgba(0,0,0,0.6)]"
      aria-label="Conversation history"
    >
      <div className="flex items-center justify-between">
        <h2 className="section-title">History</h2>
        <span className="text-[12px] text-ink-faint">{entries.length} entries</span>
      </div>

      {entries.length === 0 ? (
        <p className="text-[12px] leading-relaxed text-ink-faint">
          Past conversation turns land here after each session.
        </p>
      ) : (
        <ol className="relative flex flex-col gap-1">
          {entries.map((entry) => {
            const open = openId === entry.id;
            return (
              <li key={entry.id} className="relative pl-5">
                {/* Timeline spine + node */}
                <span
                  className="absolute bottom-0 left-[5px] top-0 w-px bg-line-strong"
                  aria-hidden="true"
                />
                <span
                  className={`absolute left-0 top-[7px] h-[11px] w-[11px] rounded-full border-2 ${
                    open
                      ? "border-accent bg-accent/30"
                      : entry.role === "user"
                        ? "border-graphite-500 bg-graphite-850"
                        : "border-graphite-500 bg-graphite-800"
                  }`}
                  aria-hidden="true"
                />
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : entry.id)}
                  aria-expanded={open}
                  className="flex w-full items-baseline gap-2 rounded-md px-1 py-1 text-left transition-colors duration-150 hover:bg-white/[0.04]"
                >
                  <span className="w-16 flex-none text-[11px] text-ink-faint">
                    {formatTime(entry.timestamp, true)}
                  </span>
                  <span className="flex-1 truncate text-[13px]">
                    <span className="mr-2 font-medium text-ink-low">
                      {ROLE_LABEL[entry.role] ?? entry.role}
                    </span>
                    <span className="truncate text-ink-mid">{entry.text}</span>
                  </span>
                </button>
                {open && (
                  <p className="mb-2 mt-0.5 whitespace-pre-wrap break-words rounded-lg bg-graphite-850 px-3 py-2 text-[12px] leading-relaxed text-ink-mid">
                    {entry.text}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {sessionId && (
        <p className="border-t border-line pt-3 font-mono text-[11px] text-ink-faint">
          session {sessionId}
        </p>
      )}
    </section>
  );
}
