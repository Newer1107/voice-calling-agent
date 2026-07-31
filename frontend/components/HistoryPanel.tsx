"use client";

import { useState } from "react";

import type { ConversationEntry } from "@/hooks/use-voice-agent";

interface HistoryPanelProps {
  entries: ConversationEntry[];
  sessionId: string;
}

function formatTime(timestamp: string): string {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function HistoryPanel({ entries, sessionId }: HistoryPanelProps) {
  const [open, setOpen] = useState(false);

  return (
    <section className="panel" aria-label="Conversation history">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="history-content"
        className="panel-header w-full text-left hover:bg-white/5"
      >
        <h2 className="panel-title">History</h2>
        <span className="flex items-center gap-2">
          {sessionId && (
            <span className="hidden max-w-32 truncate font-mono text-[10px] text-slate-500 sm:inline">
              {sessionId}
            </span>
          )}
          <svg
            className={`h-4 w-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M6 9l6 6 6-6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>

      {open && (
        <div id="history-content" className="max-h-72 overflow-y-auto p-4">
          {entries.length === 0 ? (
            <p className="text-sm text-slate-500">
              No history yet. Past sessions appear here once the agent serves
              them from <span className="font-mono text-xs">/history</span>.
            </p>
          ) : (
            <ol className="flex flex-col gap-2.5">
              {entries.map((entry) => (
                <li key={entry.id} className="flex items-start gap-2">
                  <span
                    className={`mt-0.5 flex h-4 w-9 flex-none items-center justify-center rounded text-[9px] font-bold uppercase tracking-wide ${
                      entry.role === "user"
                        ? "bg-brand-500/20 text-brand-300"
                        : "bg-voice-500/20 text-voice-300"
                    }`}
                  >
                    {entry.role}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] leading-snug text-slate-200">{entry.text}</p>
                    <p className="mt-0.5 text-[10px] text-slate-600">
                      {formatTime(entry.timestamp)}
                      {entry.source === "history" && (
                        <span className="ml-1.5 rounded border border-white/10 bg-white/5 px-1 text-[9px] uppercase tracking-wide text-slate-500">
                          past
                        </span>
                      )}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}
