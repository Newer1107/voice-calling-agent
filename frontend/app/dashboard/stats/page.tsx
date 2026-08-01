"use client";

import { motion } from "framer-motion";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status";
import { CHART_TICK, CHART_TOOLTIP_STYLE } from "@/components/dashboard/sparkline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton, SkeletonCard } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { dashboardApi, type StatsData } from "@/lib/dashboard-api";
import { formatCurrency, formatLatency, formatSeconds } from "@/lib/format";

const AXIS_PROPS = {
  tick: CHART_TICK,
  axisLine: false as const,
  tickLine: false as const,
  stroke: "var(--color-line)",
  fontSize: 10,
} as const;

type Tone = "default" | "success" | "warning" | "error";

const TONE_TEXT: Record<Tone, string> = {
  default: "text-ink-high",
  success: "text-success",
  warning: "text-warning",
  error: "text-error",
};

function StatTile({
  label,
  value,
  caption,
  tone = "default",
  index = 0,
}: {
  label: string;
  value: string;
  caption?: string;
  tone?: Tone;
  index?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: index * 0.03 }}
    >
      <Card className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium uppercase tracking-[0.08em] text-ink-low">
          {label}
        </span>
        <span className={`text-[28px] font-semibold leading-none tracking-[-0.02em] tabular-nums ${TONE_TEXT[tone]}`}>
          {value}
        </span>
        {caption && <span className="text-[12px] text-ink-faint">{caption}</span>}
      </Card>
    </motion.div>
  );
}

function MiniStat({ label, value, tone = "default" }: { label: string; value: string; tone?: Tone }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-line bg-graphite-850/50 p-4">
      <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-faint">{label}</span>
      <span className={`text-[22px] font-semibold leading-none tracking-[-0.02em] tabular-nums ${TONE_TEXT[tone]}`}>
        {value}
      </span>
    </div>
  );
}

function BarRow({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-40 flex-none truncate text-[13px] text-ink-mid">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
        <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-10 flex-none text-right font-mono text-[12px] tabular-nums text-ink-low">
        {value}
      </span>
    </div>
  );
}

function Section({
  title,
  hint,
  delay = 0,
  children,
}: {
  title: string;
  hint?: string;
  delay?: number;
  children: ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.985 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2, delay }}
    >
      <Card>
        <CardHeader title={title} hint={hint} />
        {children}
      </Card>
    </motion.div>
  );
}

function ChartEmpty() {
  return (
    <div className="flex h-full w-full items-center justify-center text-[12px] text-ink-faint">
      No data yet
    </div>
  );
}

export default function StatsPage() {
  const [data, setData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    const stats = await dashboardApi.stats();
    if (stats) {
      setData(stats);
    } else {
      setError(true);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !data) {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader
          title="Statistics"
          subtitle="Membership, bookings, orders, inventory and AI tool performance at a glance."
        />
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Card key={i}>
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="mt-4 h-48 w-full" />
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader
          title="Statistics"
          subtitle="Membership, bookings, orders, inventory and AI tool performance at a glance."
        />
        <Card>
          <div className="flex items-center gap-3">
            <span className="h-2 w-2 flex-none rounded-full bg-error" aria-hidden="true" />
            <span className="text-[13px] text-ink-low">
              {error
                ? "Could not load statistics — the agent API is unreachable."
                : "No statistics available yet."}
            </span>
            <span className="ml-auto">
              <Button variant="ghost" onClick={() => void load()}>
                Retry
              </Button>
            </span>
          </div>
        </Card>
      </div>
    );
  }

  const { members, bookings, orders, inventory, conversations, tools, revenue, peakHours } = data;
  const maxService = Math.max(0, ...bookings.byService.map((s) => s.count));
  const convTotal = conversations.ok + conversations.failed;
  const convOkPct = convTotal > 0 ? (conversations.ok / convTotal) * 100 : 0;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Statistics"
        subtitle="Membership, bookings, orders, inventory and AI tool performance at a glance."
        right={
          <Button variant="ghost" onClick={() => void load()} disabled={loading}>
            Refresh
          </Button>
        }
      />

      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile index={0} label="Members" value={String(members.total)} caption="active memberships" />
        <StatTile index={1} label="Active bookings" value={String(bookings.upcoming)} caption="upcoming appointments" />
        <StatTile index={2} label="Orders" value={String(orders.total)} caption={`${formatCurrency(orders.revenue)} lifetime`} />
        <StatTile index={3} label="Inventory" value={String(inventory.products)} caption={`${inventory.outOfStock} out of stock`} />
        <StatTile index={4} label="Total visits" value={String(members.totalVisits)} caption="member visits" />
        <StatTile
          index={5}
          label="Expiring ≤30 days"
          value={String(members.expiringSoon30)}
          tone={members.expiringSoon30 > 0 ? "warning" : "default"}
          caption={members.expiringSoon7 > 0 ? `${members.expiringSoon7} within 7 days` : "no renewals due"}
        />
        <StatTile index={6} label="Conversations" value={String(conversations.total)} caption={`${conversations.totalMessages} messages`} />
        <StatTile index={7} label="Tool executions" value={String(tools.executions)} caption={`${tools.successRate}% success`} />
      </div>

      <Section title="Membership" hint="tier distribution · renewals" delay={0.05}>
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          <div className="h-52 lg:col-span-2">
            {members.byTier.length === 0 ? (
              <ChartEmpty />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={members.byTier} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="var(--color-line)" strokeDasharray="4 6" horizontal={false} />
                  <XAxis type="number" {...AXIS_PROPS} allowDecimals={false} />
                  <YAxis type="category" dataKey="tier" {...AXIS_PROPS} width={80} interval={0} />
                  <Tooltip
                    contentStyle={CHART_TOOLTIP_STYLE}
                    labelStyle={{ color: "var(--color-ink-mid)", fontSize: 11 }}
                    cursor={{ fill: "rgba(255,255,255,0.04)" }}
                  />
                  <Bar dataKey="count" name="members" fill="var(--color-accent)" fillOpacity={0.75} radius={[0, 3, 3, 0]} barSize={16} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2.5 rounded-xl border border-line bg-graphite-850/50 p-4">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-low">
                Expiring soon
              </span>
              <div className="flex items-baseline justify-between">
                <span className="text-[12px] text-ink-low">within 30 days</span>
                <span className={`font-mono text-[15px] font-semibold tabular-nums ${members.expiringSoon30 > 0 ? "text-warning" : "text-ink-mid"}`}>
                  {members.expiringSoon30}
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-[12px] text-ink-low">within 7 days</span>
                <span className={`font-mono text-[15px] font-semibold tabular-nums ${members.expiringSoon7 > 0 ? "text-error" : "text-ink-mid"}`}>
                  {members.expiringSoon7}
                </span>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-line bg-graphite-850/50 px-4 py-3.5">
              <span className="text-[12px] text-ink-low">Total visits</span>
              <span className="font-mono text-[15px] font-semibold tabular-nums text-ink-high">
                {members.totalVisits}
              </span>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Bookings" hint="upcoming · today · spa · gym" delay={0.1}>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <MiniStat label="Upcoming" value={String(bookings.upcoming)} />
          <MiniStat label="Today" value={String(bookings.today)} />
          <MiniStat label="Spa" value={String(bookings.spa)} />
          <MiniStat label="Gym" value={String(bookings.gym)} />
        </div>
        <div className="mt-6">
          <span className="section-title">Most booked services</span>
          {bookings.byService.length === 0 ? (
            <p className="mt-3 text-[12px] text-ink-faint">No services booked yet.</p>
          ) : (
            <div className="mt-3 flex flex-col gap-2.5">
              {bookings.byService.map((s) => (
                <BarRow key={s.service} label={s.service} value={s.count} max={maxService} />
              ))}
            </div>
          )}
        </div>
      </Section>

      <Section title="Orders & revenue" hint="bookings + merchandise" delay={0.15}>
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          <div className="flex flex-col gap-3 lg:col-span-2">
            <span className="section-title">Revenue</span>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <MiniStat label="Today" value={formatCurrency(revenue.today)} />
              <MiniStat label="This week" value={formatCurrency(revenue.week)} />
              <MiniStat label="This month" value={formatCurrency(revenue.month)} />
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <span className="section-title">Orders</span>
            <div className="flex flex-col gap-2.5 rounded-xl border border-line bg-graphite-850/50 p-4">
              {orders.byStatus.length === 0 ? (
                <span className="text-[12px] text-ink-faint">No orders yet.</span>
              ) : (
                orders.byStatus.map((s) => (
                  <div key={s.status} className="flex items-center justify-between gap-3">
                    <StatusBadge status={s.status} />
                    <span className="font-mono text-[13px] tabular-nums text-ink-mid">{s.count}</span>
                  </div>
                ))
              )}
              <div className="mt-1 flex items-center justify-between border-t border-line pt-3">
                <span className="text-[12px] text-ink-low">Avg order value</span>
                <span className="font-mono text-[14px] font-semibold tabular-nums text-ink-high">
                  {formatCurrency(orders.avgValue)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Inventory" hint="low stock alerts" delay={0.2}>
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <span className="section-title">Low stock</span>
            {inventory.lowStock.length === 0 ? (
              <p className="mt-3 text-[12px] text-ink-faint">All items are sufficiently stocked.</p>
            ) : (
              <div className="mt-3 flex flex-col">
                {inventory.lowStock.map((item) => (
                  <div key={item.name} className="flex items-center gap-4 border-b border-line py-3 last:border-none">
                    <span className="text-[13px] font-medium text-ink-high">{item.name}</span>
                    <span className="ml-auto">
                      <Badge tone={item.stock === 0 ? "error" : item.stock <= 5 ? "warning" : "neutral"}>
                        {item.stock === 0 ? "out of stock" : `${item.stock} left`}
                      </Badge>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-3">
            <span className="section-title">Stock health</span>
            <MiniStat
              label="Out of stock"
              value={String(inventory.outOfStock)}
              tone={inventory.outOfStock > 0 ? "error" : "default"}
            />
            <MiniStat label="Products" value={String(inventory.products)} />
          </div>
        </div>
      </Section>

      <Section title="Conversations & tools" hint="agent + webhook performance" delay={0.25}>
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          <div className="flex flex-col gap-3">
            <span className="section-title">Conversations</span>
            <div className="rounded-xl border border-line bg-graphite-850/50 p-4">
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-ink-low">outcome split</span>
                <span className="font-mono tabular-nums text-ink-faint">
                  {conversations.ok} ok · {conversations.failed} failed
                </span>
              </div>
              <div className="mt-2.5 flex h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                {convTotal > 0 && (
                  <>
                    <div className="h-full bg-success" style={{ width: `${convOkPct}%` }} />
                    <div className="h-full bg-error" style={{ width: `${100 - convOkPct}%` }} />
                  </>
                )}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-4 border-t border-line pt-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[11px] uppercase tracking-[0.08em] text-ink-faint">Avg duration</span>
                  <span className="font-mono text-[15px] font-semibold tabular-nums text-ink-high">
                    {formatSeconds(conversations.avgDurationSec)}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[11px] uppercase tracking-[0.08em] text-ink-faint">Total messages</span>
                  <span className="font-mono text-[15px] font-semibold tabular-nums text-ink-high">
                    {conversations.totalMessages}
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <span className="section-title">Tools</span>
            <div className="grid grid-cols-3 gap-4">
              <MiniStat label="Executions" value={String(tools.executions)} />
              <MiniStat
                label="Success rate"
                value={`${tools.successRate}%`}
                tone={tools.successRate >= 95 ? "success" : tools.successRate >= 80 ? "warning" : "error"}
              />
              <MiniStat label="Avg latency" value={formatLatency(tools.avgLatencyMs)} />
            </div>
            <div className="overflow-hidden rounded-xl border border-line bg-graphite-850/50">
              <Table>
                <THead>
                  <TR className="border-none">
                    <TH>Tool</TH>
                    <TH className="text-right">Executions</TH>
                    <TH className="text-right">OK</TH>
                    <TH className="text-right">Failed</TH>
                  </TR>
                </THead>
                <TBody>
                  {tools.byTool.length === 0 ? (
                    <TR>
                      <TD className="py-6 text-center text-[12px] text-ink-faint">No tool activity yet.</TD>
                    </TR>
                  ) : (
                    tools.byTool.map((t) => {
                      const failed = t.count - t.ok;
                      return (
                        <TR key={t.tool}>
                          <TD className="font-medium text-ink-high">{t.tool}</TD>
                          <TD className="text-right font-mono tabular-nums">{t.count}</TD>
                          <TD className="text-right font-mono tabular-nums text-success">{t.ok}</TD>
                          <TD className={`text-right font-mono tabular-nums ${failed > 0 ? "text-error" : "text-ink-low"}`}>
                            {failed}
                          </TD>
                        </TR>
                      );
                    })
                  )}
                </TBody>
              </Table>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Peak hours" hint="busiest hours of the day" delay={0.3}>
        <div className="h-56">
          {peakHours.length === 0 ? (
            <ChartEmpty />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={peakHours} margin={{ top: 4, right: 4, bottom: 0, left: -22 }}>
                <CartesianGrid stroke="var(--color-line)" strokeDasharray="4 6" vertical={false} />
                <XAxis dataKey="hour" {...AXIS_PROPS} tickFormatter={(h: number) => `${h}:00`} />
                <YAxis {...AXIS_PROPS} allowDecimals={false} />
                <Tooltip
                  contentStyle={CHART_TOOLTIP_STYLE}
                  labelStyle={{ color: "var(--color-ink-mid)", fontSize: 11 }}
                  cursor={{ fill: "rgba(255,255,255,0.04)" }}
                />
                <Bar dataKey="count" name="calls" fill="var(--color-accent)" fillOpacity={0.75} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </Section>
    </div>
  );
}
