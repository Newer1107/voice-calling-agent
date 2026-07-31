"use client";

import { useEffect, useRef } from "react";

import type { AiMessage, UserTurn } from "@/hooks/use-voice-agent";

interface TranscriptPanelProps {
  userTranscript: UserTurn[];
  aiMessages: AiMessage[];
  agentName: string;
  connected: boolean;
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-3 animate-shimmer rounded-full bg-gradient-to-r from-white/5 via-white/10 to-white/5"
          style={{ width: `${92 - i * 18}%`, backgroundSize: "800px 100%" }}
        />
      ))}
    </div>
  );
}

function EmptyState({ connected, agentName }: { connected: boolean; agentName: string }) {
  return (
    <div className="flex h-full min-h-48 flex-col items-center justify-center gap-3 text-center text-sm text-slate-500">
      <span
        className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-400"
        aria-hidden="true"
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          {connected ? (
            <path
              d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Zm-6 9a6 6 0 0 0 12 0M12 17v4m-3 0h6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : (
            <path
              d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.4-4 8-9 8-1 0-2-.1-2.9-.4L4 21l1.4-3.2C3.9 16.4 3 14.3 3 12c0-4.4 4-8 9-8s9 3.6 9 8Z"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </svg>
      </span>
      {connected ? (
        <p>
          Listening… say something to {agentName}
        </p>
      ) : (
        <>
          <p>No conversation yet — press Connect</p>
          <p className="text-xs text-slate-600">
            Your transcript and the agent&apos;s replies will appear here.
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

  const hasContent = userTranscript.length > 0 || aiMessages.length > 0;

  return (
    <section className="panel flex h-full min-h-[28rem] flex-col" aria-label="Transcript">
      <div className="panel-header">
        <h2 className="panel-title">Transcript</h2>
        <span className="text-[11px] text-slate-500">
          You ↔ {agentName}
        </span>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-5 overflow-y-auto p-4">
        {!hasContent && connected && <Skeleton />}
        {!hasContent && !connected && <EmptyState connected={false} agentName={agentName} />}

        {userTranscript.length > 0 && (
          <section aria-label="Your transcript" className="flex flex-col gap-2.5">
            {userTranscript.map((turn) => (
              <div key={turn.id} className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded bg-brand-500/20 text-[10px] font-bold text-brand-300">
                  You
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-sm leading-relaxed text-slate-200 ${
                      turn.final ? "" : "italic text-slate-300"
                    }`}
                  >
                    {turn.text}
                    {!turn.final && turn.text.length > 0 && (
                      <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse-soft bg-brand-400 align-middle" />
                    )}
                  </p>
                  <p className="mt-0.5 text-[10px] text-slate-600">{formatTime(turn.timestamp)}</p>
                </div>
              </div>
            ))}
          </section>
        )}

        {aiMessages.length > 0 && (
          <section aria-label="Agent replies" className="flex flex-col gap-2.5">
            {aiMessages.map((message) => (
              <div key={message.id} className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded bg-voice-500/20 text-[10px] font-bold text-voice-300">
                  AI
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-relaxed text-slate-100">
                    {message.text}
                    {!message.done && (
                      <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse-soft bg-voice-400 align-middle" />
                    )}
                  </p>
                  <p className="mt-0.5 text-[10px] text-slate-600">{formatTime(message.timestamp)}</p>
                </div>
              </div>
            ))}
          </section>
        )}
      </div>
    </section>
  );
}
