"use client";

import { useEffect, useMemo, useRef } from "react";

import type { AiMessage, UserTurn } from "@/hooks/use-voice-agent";
import { formatTime } from "@/lib/format";

interface TranscriptPanelProps {
  userTranscript: UserTurn[];
  aiMessages: AiMessage[];
  agentName: string;
  connected: boolean;
  thinking: boolean;
}

type UserChatItem = {
  kind: "user";
  id: string;
  text: string;
  final: boolean;
  timestamp: string;
};

type AgentChatItem = {
  kind: "agent";
  id: string;
  text: string;
  done: boolean;
  timestamp: string;
};

type ChatItem = UserChatItem | AgentChatItem;

function Cursor() {
  return (
    <span
      className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[3px] animate-blink bg-ink-mid"
      aria-hidden="true"
    />
  );
}

function TypingIndicator() {
  return (
    <div
      className="flex items-center gap-1 px-1 py-1.5"
      role="status"
      aria-label="Agent is typing"
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 animate-typing-dot rounded-full bg-ink-low"
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </div>
  );
}

function MicIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Zm-6 9a6 6 0 0 0 12 0M12 17v4m-3 0h6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-3 rounded-full bg-white/[0.045]"
          style={{ width: `${88 - i * 22}%` }}
        />
      ))}
    </div>
  );
}

function EmptyState({ connected, agentName }: { connected: boolean; agentName: string }) {
  return (
    <div className="flex h-full min-h-56 flex-col items-center justify-center gap-3 text-center">
      <span
        className="flex h-12 w-12 items-center justify-center rounded-full bg-graphite-850 text-ink-low"
        aria-hidden="true"
      >
        <MicIcon />
      </span>
      {connected ? (
        <p className="text-[15px] text-ink-low">Listening… say something to {agentName}</p>
      ) : (
        <>
          <p className="text-[15px] text-ink-mid">No conversation yet</p>
          <p className="max-w-xs text-[13px] leading-relaxed text-ink-faint">
            Press Connect to start. Your speech and the agent&apos;s replies
            appear here in real time.
          </p>
        </>
      )}
    </div>
  );
}

export function TranscriptPanel({
  userTranscript,
  aiMessages,
  agentName,
  connected,
  thinking,
}: TranscriptPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Only stick to the bottom when the user is already near it; don't yank
    // readers up to the newest message while they're scrolling history.
    const threshold = 48;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [userTranscript, aiMessages]);

  // Interleave both streams chronologically into one conversation.
  const groups = useMemo(() => {
    const merged: ChatItem[] = [
      ...userTranscript.map((t) => ({
        kind: "user" as const,
        id: t.id,
        text: t.text,
        final: t.final,
        timestamp: t.timestamp,
      })),
      ...aiMessages.map((m) => ({
        kind: "agent" as const,
        id: m.id,
        text: m.text,
        done: m.done,
        timestamp: m.timestamp,
      })),
    ].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    const grouped: { kind: ChatItem["kind"]; items: ChatItem[] }[] = [];
    for (const item of merged) {
      const last = grouped[grouped.length - 1];
      if (last && last.kind === item.kind) last.items.push(item);
      else grouped.push({ kind: item.kind, items: [item] });
    }
    return grouped;
  }, [userTranscript, aiMessages]);

  const hasContent = userTranscript.length > 0 || aiMessages.length > 0;
  const agentInitial = agentName.trim().charAt(0).toUpperCase() || "A";

  return (
    <section
      className="flex h-full min-h-[30rem] flex-col overflow-hidden rounded-2xl border border-line bg-graphite-900 shadow-[0_1px_0_rgba(255,255,255,0.02)_inset,0_16px_40px_-20px_rgba(0,0,0,0.6)]"
      aria-label="Conversation"
    >
      <div className="flex items-center justify-between border-b border-line px-7 py-4">
        <h2 className="section-title">Conversation</h2>
        <span className="text-[12px] text-ink-faint">You ↔ {agentName}</span>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-7 sm:px-8">
        {!hasContent && connected && !thinking && <Skeleton />}
        {!hasContent && connected && thinking && <TypingIndicator />}
        {!hasContent && !connected && <EmptyState connected={false} agentName={agentName} />}

        {hasContent && (
          <div className="flex flex-col gap-8">
            {groups.map((group, gi) =>
              group.kind === "user" ? (
                <div key={`u-${gi}`} className="flex flex-col items-end gap-1.5">
                  {group.items.map((item, i) => (
                    <div key={item.id} className="flex max-w-[85%] flex-col items-end">
                      <p
                        className={`rounded-2xl rounded-br-md bg-graphite-850 px-4 py-2.5 text-[15px] leading-relaxed shadow-[0_1px_2px_rgba(0,0,0,0.4)] ${
                          (item as UserChatItem).final ? "text-ink-high" : "italic text-ink-mid"
                        }`}
                      >
                        {item.text}
                        {!(item as UserChatItem).final && item.text.length > 0 && <Cursor />}
                      </p>
                      {i === 0 && (
                        <p className="mt-1.5 pr-1 text-[11px] text-ink-faint">
                          {formatTime(item.timestamp, true)}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (                <div key={`a-${gi}`} className="flex flex-col gap-1.5">
                  {group.items.map((item, i) => (
                    <div key={item.id} className="flex items-start gap-3">
                      {i === 0 ? (
                        <span className="mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-full bg-graphite-800 text-[12px] font-semibold text-ink-mid">
                          {agentInitial}
                        </span>
                      ) : (
                        <span className="mt-0.5 h-7 w-7 flex-none" aria-hidden="true" />
                      )}
                      <div className="min-w-0">
                        {i === 0 && (
                          <p className="flex items-baseline gap-2 text-[12px]">
                            <span className="font-semibold text-ink-mid">{agentName}</span>
                            <span className="text-ink-faint">
                              {formatTime(item.timestamp, true)}
                            </span>
                          </p>
                        )}
                        <p
                          className={`mt-0.5 text-[15px] leading-relaxed ${
                            (item as AgentChatItem).done ? "text-ink-high" : "text-ink-mid"
                          }`}
                        >
                          {item.text}
                          {!(item as AgentChatItem).done && item.text.length > 0 && <Cursor />}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ),
            )}
            {thinking && <TypingIndicator />}
          </div>
        )}
      </div>
    </section>
  );
}
