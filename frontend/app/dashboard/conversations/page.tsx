"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useMemo } from "react";

import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { TierBadge } from "@/components/dashboard/status";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useNow } from "@/hooks/use-now";
import type { ActiveConversation } from "@/lib/dashboard-store";
import { useDashboard } from "@/lib/dashboard-store";
import { formatDuration, formatTime } from "@/lib/format";

type ConvState = "speaking" | "listening" | "tool" | "idle";

function stateOf(conversation: ActiveConversation): ConvState {
  if (conversation.currentTool) return "tool";
  const last = conversation.messages[conversation.messages.length - 1];
  if (!last) return "idle";
  return last.role === "assistant" ? "speaking" : "listening";
}

const STATE_META: Record<ConvState, { label: string; dot: string }> = {
  speaking: { label: "Speaking", dot: "bg-success animate-pulse-soft" },
  listening: { label: "Listening", dot: "bg-accent animate-pulse-soft" },
  tool: { label: "Running tool", dot: "bg-warning animate-pulse-soft" },
  idle: { label: "Connected", dot: "bg-ink-faint" },
};

function ConversationCard({ conversation, now }: { conversation: ActiveConversation; now: number }) {
  const convState = stateOf(conversation);
  const meta = STATE_META[convState];
  const elapsed = Math.max(0, now - new Date(conversation.startedAt).getTime());
  const recent = conversation.messages.slice(-4);
  const lastAi = [...conversation.messages].reverse().find((m) => m.role === "assistant");

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.2 }}
    >
      <Card className="flex flex-col gap-5">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <span className={`h-2 w-2 flex-none rounded-full ${meta.dot}`} aria-hidden="true" />
              <h3 className="truncate text-[15px] font-semibold tracking-tight text-ink-high">
                {conversation.customerName ?? "Caller"}
              </h3>
              {conversation.customer && (
                <TierBadge tier={conversation.customer.tier} />
              )}
            </div>
            <p className="mt-1 text-[12px] text-ink-faint">
              started {formatTime(conversation.startedAt)}
            </p>
          </div>
          <div className="flex flex-none items-center gap-4">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-low">
              {meta.label}
            </span>
            <span className="font-mono text-[13px] tabular-nums text-ink-mid">
              {formatDuration(elapsed)}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          {recent.length === 0 ? (
            <p className="text-[12px] text-ink-faint">Waiting for the first exchange…</p>
          ) : (
            recent.map((message, i) => (
              <div key={`${message.ts}-${i}`} className="flex items-start gap-2.5">
                <span
                  className={`mt-1 h-1.5 w-1.5 flex-none rounded-full ${
                    message.role === "assistant" ? "bg-accent" : "bg-ink-faint"
                  }`}
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
                    {message.role === "assistant" ? "Agent" : "Customer"}
                  </p>
                  <p
                    className={`mt-0.5 text-[13px] leading-relaxed ${
                      message.role === "assistant" ? "text-ink-high" : "text-ink-mid"
                    }`}
                  >
                    {message.text}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-line pt-4">
          {conversation.currentTool ? (
            <div className="flex items-center gap-3 rounded-lg border border-warning/25 bg-warning/[0.05] px-3 py-2">
              <svg className="h-3.5 w-3.5 flex-none animate-spin text-warning" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.5" />
                <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
              <span className="truncate text-[12px] font-medium text-ink-high">
                {conversation.currentTool.tool}
              </span>
              <span className="truncate font-mono text-[11px] text-ink-faint">
                {JSON.stringify(conversation.currentTool.args)}
              </span>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5">
              {conversation.tools.filter((t) => t.ok !== undefined).slice(-3).map((tool, i) => (
                <span
                  key={`${tool.tool}-${i}`}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium ${
                    tool.ok ? "bg-success-soft text-success" : "bg-error-soft text-error"
                  }`}
                >
                  <span className="h-1 w-1 rounded-full bg-current opacity-70" aria-hidden="true" />
                  {tool.tool}
                </span>
              ))}
            </div>
          )}
          {lastAi && (
            <p className="text-[11px] text-ink-faint">
              Last AI response: <span className="text-ink-low">{lastAi.text.slice(0, 120)}{lastAi.text.length > 120 ? "…" : ""}</span>
            </p>
          )}
        </div>
      </Card>
    </motion.div>
  );
}

export default function LiveConversationsPage() {
  const { state, loading } = useDashboard();
  const now = useNow(1_000);
  const active = useMemo(
    () => [...state.active].sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    [state.active],
  );

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Live Conversations"
        subtitle="Every call happening right now, streamed from the agent."
        right={
          <span className="flex items-center gap-2 text-[12px] font-medium text-ink-low">
            <span className={`h-2 w-2 rounded-full ${active.length > 0 ? "bg-success animate-pulse-soft" : "bg-ink-faint"}`} aria-hidden="true" />
            {active.length} active
          </span>
        }
      />

      {loading && state.active.length === 0 ? (
        <div className="grid gap-5 lg:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="rounded-2xl border border-line bg-graphite-900 p-6 sm:p-7">
              <div className="flex flex-col gap-5">
                <Skeleton className="h-5 w-40" />
                <div className="flex flex-col gap-3">
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
                <Skeleton className="h-9 w-full" />
              </div>
            </div>
          ))}
        </div>
      ) : active.length === 0 ? (
        <EmptyState
          title="No active conversations"
          hint="When a caller connects to the voice agent, the call appears here in real time — transcript, tool executions and duration included."
        />
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-2">
          <AnimatePresence mode="popLayout">
            {active.map((conversation) => (
              <ConversationCard key={conversation.id} conversation={conversation} now={now} />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
