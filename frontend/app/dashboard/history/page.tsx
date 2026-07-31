"use client";

import { motion } from "framer-motion";
import { useState } from "react";

import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge, TierBadge } from "@/components/dashboard/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { ConversationDetail } from "@/lib/dashboard-api";
import { useDashboard } from "@/lib/dashboard-store";
import { formatDate, formatDuration, formatLatency, formatSeconds, formatTime } from "@/lib/format";

function DetailDialog({
  open,
  detail,
  loading,
  error,
  onClose,
}: {
  open: boolean;
  detail: ConversationDetail | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title="Conversation" wide>
      {loading && (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      )}
      {error && <p className="text-[13px] leading-relaxed text-error">{error}</p>}
      {detail && (
        <div className="flex flex-col gap-7">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[12px] text-ink-low">
            {detail.customerName && (
              <span className="flex items-center gap-2 text-ink-mid">
                {detail.customerName}
                
              </span>
            )}
            <span>{formatDate(detail.startedAt)} · {formatTime(detail.startedAt, true)}</span>
            <span>{formatSeconds(detail.durationSec)}</span>
            <span>{detail.messages.length} messages</span>
            <StatusBadge status={detail.outcome} />
          </div>

          <section aria-label="Transcript">
            <h3 className="section-title mb-4">Transcript</h3>
            {detail.messages.length === 0 ? (
              <p className="text-[12px] text-ink-faint">No transcript recorded.</p>
            ) : (
              <div className="flex flex-col gap-4">
                {detail.messages.map((message, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <span
                      className={`mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full text-[10px] font-semibold ${
                        message.role === "assistant" ? "bg-accent/15 text-accent-hover" : "bg-graphite-800 text-ink-mid"
                      }`}
                    >
                      {message.role === "assistant" ? "A" : "U"}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[11px] text-ink-faint">{formatTime(message.ts, true)}</p>
                      <p className={`mt-0.5 text-[13px] leading-relaxed ${message.role === "assistant" ? "text-ink-high" : "text-ink-mid"}`}>
                        {message.text}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section aria-label="Tool calls">
            <h3 className="section-title mb-4">Tool Calls</h3>
            {detail.toolExecutions.length === 0 ? (
              <p className="text-[12px] text-ink-faint">No tools were invoked.</p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {detail.toolExecutions.map((tool, i) => (
                  <div key={i} className="rounded-lg border border-line bg-graphite-850 px-3.5 py-3">
                    <div className="flex items-center gap-3">
                      <span className={`h-1.5 w-1.5 flex-none rounded-full ${tool.ok ? "bg-success" : "bg-error"}`} aria-hidden="true" />
                      <span className="text-[13px] font-medium text-ink-high">{tool.tool}</span>
                      <span className="ml-auto font-mono text-[11px] tabular-nums text-ink-low">
                        {tool.durationMs !== undefined ? formatLatency(tool.durationMs) : "—"}
                      </span>
                      <Badge tone={tool.ok ? "success" : "error"}>{tool.ok ? "ok" : "failed"}</Badge>
                    </div>
                    <p className="mt-2 truncate font-mono text-[11px] text-ink-faint">
                      {JSON.stringify(tool.args)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </Dialog>
  );
}

export default function HistoryPage() {
  const { state, loading, fetchConversation } = useDashboard();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openDetail = async (id: string) => {
    setSelectedId(id);
    setDetail(null);
    setError(null);
    setDetailLoading(true);
    const result = await fetchConversation(id);
    setDetailLoading(false);
    if (result) setDetail(result);
    else setError("Could not load this conversation.");
  };

  const close = () => {
    setSelectedId(null);
    setDetail(null);
    setError(null);
  };

  const history = state.history ?? [];

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="History"
        subtitle="Every conversation the agent has handled, in one place."
        right={<span className="text-[12px] text-ink-faint">{history.length} conversations</span>}
      />

      {loading && state.history === null ? (
        <Card>
          <div className="flex flex-col gap-4">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        </Card>
      ) : history.length === 0 ? (
        <EmptyState
          title="No conversations yet"
          hint="Completed calls will be recorded here with transcripts, tool calls and outcomes."
        />
      ) : (
        <Card padding={false}>
          <div className="px-6 pb-2 pt-6 sm:px-7">
            <CardHeader title="Recent calls" hint="click a row for the full transcript" />
          </div>
          <div className="px-6 pb-6 sm:px-7">
            <Table>
              <THead>
                <TR className="border-none">
                  <TH>Time</TH>
                  <TH>Customer</TH>
                  <TH>Duration</TH>
                  <TH>Summary</TH>
                  <TH>Outcome</TH>
                  <TH>Tools Used</TH>
                </TR>
              </THead>
              <TBody>
                {history.map((entry) => (
                  <TR key={entry.id} onClick={() => void openDetail(entry.id)}>
                    <TD className="whitespace-nowrap">
                      <span className="text-ink-high">{formatTime(entry.startedAt, true)}</span>
                      <span className="ml-2 text-[11px] text-ink-faint">{formatDate(entry.startedAt)}</span>
                    </TD>
                    <TD className="font-medium text-ink-high">{entry.customerName ?? "—"}</TD>
                    <TD className="whitespace-nowrap font-mono tabular-nums">{formatSeconds(entry.durationSec)}</TD>
                    <TD className="max-w-[280px] truncate text-ink-low">{entry.summary || "—"}</TD>
                    <TD><StatusBadge status={entry.outcome} /></TD>
                    <TD>
                      {entry.toolsUsed.length > 0 ? (
                        <span className="flex flex-wrap gap-1">
                          {entry.toolsUsed.slice(0, 3).map((tool) => (
                            <Badge key={tool} tone="neutral">{tool}</Badge>
                          ))}
                          {entry.toolsUsed.length > 3 && (
                            <span className="text-[11px] text-ink-faint">+{entry.toolsUsed.length - 3}</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        </Card>
      )}

      <DetailDialog
        open={selectedId !== null}
        detail={detail}
        loading={detailLoading}
        error={error}
        onClose={close}
      />
    </div>
  );
}
