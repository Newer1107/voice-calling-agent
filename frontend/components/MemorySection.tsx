"use client";

import { useMemo } from "react";

import type { AiMessage, ConversationEntry, UserTurn } from "@/hooks/use-voice-agent";
import { formatTime } from "@/lib/format";

interface MemorySectionProps {
  userTranscript: UserTurn[];
  aiMessages: AiMessage[];
  history: ConversationEntry[];
}

const NAME_PATTERNS = [
  /\b(?:my name is|i'?m called|call me)\s+([A-Z][a-z]+)/i,
  /\b(?:i am|i'm)\s+([A-Z][a-z]+)(?:\s|$)/i,
];

function extractName(transcripts: UserTurn[]): string | null {
  for (const turn of transcripts) {
    for (const re of NAME_PATTERNS) {
      const m = turn.text.match(re);
      if (m && m[1]) return m[1];
    }
  }
  return null;
}

export function MemorySection({ userTranscript, aiMessages, history }: MemorySectionProps) {
  const name = useMemo(() => extractName(userTranscript), [userTranscript]);
  const historyCount = history.length;
  const totalTurns = userTranscript.length + aiMessages.filter((m) => m.done).length;
  const lastActivity = [...userTranscript, ...aiMessages]
    .map((e) => e.timestamp)
    .filter(Boolean)
    .sort()
    .at(-1);

  return (
    <section
      className="flex flex-col gap-4 rounded-2xl border border-line bg-graphite-900 p-7 shadow-[0_1px_0_rgba(255,255,255,0.02)_inset,0_16px_40px_-20px_rgba(0,0,0,0.6)]"
      aria-label="Agent memory"
    >
      <div className="flex items-center justify-between">
        <h2 className="section-title">Memory</h2>
        {name && <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-medium text-accent-soft">Member</span>}
      </div>

      <dl className="flex flex-col gap-2.5 text-[13px]">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-ink-low">Member name</dt>
          <dd className="truncate font-medium text-ink-mid">{name ?? "Unknown"}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-ink-low">History entries</dt>
          <dd className="font-mono tabular-nums text-ink-mid">{historyCount}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-ink-low">Conversation turns</dt>
          <dd className="font-mono tabular-nums text-ink-mid">{totalTurns}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-ink-low">Last activity</dt>
          <dd className="font-mono tabular-nums text-ink-mid">
            {lastActivity ? formatTime(lastActivity, true) : "—"}
          </dd>
        </div>
      </dl>

      {name && (
        <p className="text-[11px] leading-relaxed text-ink-faint">
          Name derived from the live conversation (“my name is …”).
        </p>
      )}
    </section>
  );
}
