"use client";

import { motion } from "framer-motion";

import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SERVICE_LABELS, type ServiceHealth, type ServiceName } from "@/lib/dashboard-api";
import { useDashboard } from "@/lib/dashboard-store";

const SERVICE_ORDER: ServiceName[] = ["livekit", "ollama", "whisper", "tts", "n8n"];

function HealthBadge({ health }: { health: ServiceHealth }) {
  const tone = health === "ok" ? "success" : health === "degraded" ? "warning" : "error";
  return <Badge tone={tone}>{health}</Badge>;
}

export default function SystemPage() {
  const { state, loading, refresh } = useDashboard();

  const system = state.system;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="System"
        subtitle="Health of every service the reception desk depends on."
        right={
          <Button variant="ghost" onClick={() => void refresh("system")}>
            Refresh
          </Button>
        }
      />

      {loading && system === null ? (
        <Card>
          <div className="flex flex-col gap-4">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </Card>
      ) : !system ? (
        <EmptyState title="No system data" hint="Service health will appear once the backend is reachable." />
      ) : (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }} className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Services" hint="updated automatically via the dashboard socket" />
            <div className="mt-4 flex flex-col">
              {SERVICE_ORDER.map((name) => {
                const health = system.services[name];
                if (!health) return null;
                return (
                  <div
                    key={name}
                    className="flex items-center gap-4 border-b border-line py-3.5 last:border-none"
                  >
                    <span
                      className={`h-2 w-2 flex-none rounded-full ${
                        health === "ok" ? "bg-success" : health === "degraded" ? "bg-warning" : "bg-error"
                      }`}
                      aria-hidden="true"
                    />
                    <span className="w-28 flex-none text-[13px] font-medium text-ink-high">
                      {SERVICE_LABELS[name]}
                    </span>
                    <span className="text-[12px] capitalize text-ink-low">
                      {health === "ok" ? "operational" : health}
                    </span>
                    <span className="ml-auto">
                      <HealthBadge health={health} />
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card>
            <CardHeader title="Status" hint="last health check" />
            <div className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-2 text-[13px]">
              <span className="flex items-center gap-2 text-ink-high">
                <span
                  className={`h-2 w-2 rounded-full ${
                    Object.values(system.services).every((h) => h === "ok") ? "bg-success" : "bg-warning"
                  }`}
                  aria-hidden="true"
                />
                {Object.values(system.services).every((h) => h === "ok")
                  ? "All systems operational"
                  : "Some services degraded"}
              </span>
              <span className="font-mono text-[11px] tabular-nums text-ink-faint">
                checked {new Date(system.updatedAt).toLocaleTimeString()}
              </span>
            </div>
          </Card>
        </motion.div>
      )}
    </div>
  );
}
