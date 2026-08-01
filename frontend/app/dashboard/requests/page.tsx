"use client";

import { motion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";

import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { dashboardApi, type StaffRequest } from "@/lib/dashboard-api";
import { formatDate, formatTime } from "@/lib/format";

export default function StaffRequestsPage() {
  const [requests, setRequests] = useState<StaffRequest[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await dashboardApi.requests();
    setRequests(data ?? []);
  }, []);

  useEffect(() => {
    void load();
    const interval = setInterval(() => void load(), 15000);
    return () => clearInterval(interval);
  }, [load]);

  const complete = async (requestId: string) => {
    setBusy(requestId);
    const updated = await dashboardApi.completeRequest(requestId);
    setBusy(null);
    if (updated) {
      setRequests((prev) =>
        (prev ?? []).map((r) => (r.requestId === updated.requestId ? updated : r)),
      );
    }
  };

  const pending = (requests ?? []).filter((r) => r.status === "pending");

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Staff Requests"
        subtitle="Upgrades, renewals and payments the agent queued for the front desk."
        right={
          <span className="text-[12px] text-ink-faint">
            {pending.length} pending · {requests?.length ?? 0} total
          </span>
        }
      />

      {requests === null ? (
        <Card>
          <div className="flex flex-col gap-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </Card>
      ) : requests.length === 0 ? (
        <EmptyState
          title="No staff requests yet"
          hint="When a member asks to upgrade or renew, the agent queues it here for you to confirm."
        />
      ) : (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
          <Card padding={false}>
            <div className="overflow-x-auto px-6 py-2 sm:px-7">
              <Table>
                <THead>
                  <TR className="border-none">
                    <TH>Request</TH>
                    <TH>Member</TH>
                    <TH>Details</TH>
                    <TH>Status</TH>
                    <TH>Created</TH>
                    <TH className="text-right">Action</TH>
                  </TR>
                </THead>
                <TBody>
                  {requests.map((request) => (
                    <TR key={request.requestId}>
                      <TD className="whitespace-nowrap font-mono text-[12px] text-ink-low">
                        {request.requestId}
                      </TD>
                      <TD className="font-medium text-ink-high">{request.member}</TD>
                      <TD className="max-w-[280px] text-ink-low">
                        <span className="capitalize">{request.requestType}</span>
                        {request.details ? (
                          <span className="block text-[12px] text-ink-faint">{request.details}</span>
                        ) : null}
                      </TD>
                      <TD>
                        <Badge tone={request.status === "pending" ? "warning" : "success"}>
                          {request.status}
                        </Badge>
                      </TD>
                      <TD className="whitespace-nowrap text-ink-faint">
                        {formatDate(request.createdAt)} · {formatTime(request.createdAt)}
                      </TD>
                      <TD className="text-right">
                        {request.status === "pending" ? (
                          <Button
                            variant="ghost"
                            disabled={busy === request.requestId}
                            onClick={() => void complete(request.requestId)}
                          >
                            {busy === request.requestId ? "Confirming…" : "Confirm"}
                          </Button>
                        ) : (
                          <span className="text-[12px] text-ink-faint">done</span>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          </Card>
        </motion.div>
      )}
    </div>
  );
}
