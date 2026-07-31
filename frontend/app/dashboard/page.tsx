"use client";

import { motion } from "framer-motion";
import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { EmptyState } from "@/components/dashboard/empty-state";
import { MetricCard } from "@/components/dashboard/metric-card";
import { PageHeader } from "@/components/dashboard/page-header";
import { CHART_TICK, CHART_TOOLTIP_STYLE } from "@/components/dashboard/sparkline";
import { Card, CardHeader } from "@/components/ui/card";
import { SkeletonCard } from "@/components/ui/skeleton";
import { useDashboard } from "@/lib/dashboard-store";
import { formatCurrency, formatSeconds, formatShortDate } from "@/lib/format";

const ACCENT = "#3B82F6";
const SUCCESS = "#22C55E";
const WARNING = "#F59E0B";
const ERROR = "#EF4444";

export default function OverviewPage() {
  const { state, loading } = useDashboard();
  const overview = state.overview;

  const mergedSeries = useMemo(() => {
    if (!overview) return [];
    const rows = new Map<string, { date: string; calls: number; appointments: number; orders: number }>();
    const push = (key: "calls" | "appointments" | "orders", points: { date: string; count: number }[]) => {
      for (const point of points) {
        const row = rows.get(point.date) ?? { date: point.date, calls: 0, appointments: 0, orders: 0 };
        row[key] = point.count;
        rows.set(point.date, row);
      }
    };
    push("calls", overview.series.calls);
    push("appointments", overview.series.appointments);
    push("orders", overview.series.orders);
    return [...rows.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [overview]);

  if (loading && !overview) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Overview" subtitle="How the front desk is performing, live." />
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => <SkeletonCard key={i} />)}
        </div>
        <SkeletonCard />
      </div>
    );
  }

  if (!overview) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Overview" subtitle="How the front desk is performing, live." />
        <EmptyState
          title="Dashboard data unavailable"
          hint="Could not reach the agent API. Make sure NEXT_PUBLIC_AGENT_API_URL points at the running agent and the /dashboard endpoints are served."
        />
      </div>
    );
  }

  const { series } = overview;
  const cards = [
    {
      label: "Active Conversations",
      value: String(overview.activeConversations),
      caption: "calls in progress",
      series: series.calls,
      color: ACCENT,
    },
    {
      label: "Calls Today",
      value: String(overview.callsToday),
      caption: "answered by the agent",
      series: series.calls,
      color: ACCENT,
    },
    {
      label: "Appointments Today",
      value: String(overview.appointmentsToday),
      caption: "booked so far",
      series: series.appointments,
      color: SUCCESS,
    },
    {
      label: "Orders Today",
      value: String(overview.ordersToday),
      caption: "placed over the phone",
      series: series.orders,
      color: WARNING,
    },
    {
      label: "Revenue Today",
      value: formatCurrency(overview.revenueToday),
      caption: "bookings + merchandise",
      series: series.orders,
      color: SUCCESS,
    },
    {
      label: "Avg Call Duration",
      value: formatSeconds(overview.avgCallDuration),
      caption: "per conversation",
      series: series.calls,
      color: ACCENT,
    },
    {
      label: "AI Success Rate",
      value: `${overview.aiSuccessRate}%`,
      caption: "resolved without escalation",
      series: series.calls,
      color: SUCCESS,
    },
    {
      label: "Failed Tool Calls",
      value: String(overview.failedToolCalls),
      caption: "needed human attention",
      series: series.calls,
      color: ERROR,
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Overview"
        subtitle="How the front desk is performing, live."
        right={
          <span className="text-[12px] text-ink-faint">
            Updated {state.system?.updatedAt ? formatShortDate(state.system.updatedAt) : "in real time"}
          </span>
        }
      />

      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card, i) => (
          <MetricCard key={card.label} {...card} index={i} />
        ))}
      </div>

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: 0.2 }}>
        <Card>
          <CardHeader title="Activity today" hint="calls · appointments · orders" />
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={mergedSeries} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
                <defs>
                  <linearGradient id="today-calls" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={ACCENT} stopOpacity={0.16} />
                    <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="today-appointments" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={SUCCESS} stopOpacity={0.16} />
                    <stop offset="100%" stopColor={SUCCESS} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="today-orders" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={WARNING} stopOpacity={0.16} />
                    <stop offset="100%" stopColor={WARNING} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={CHART_TICK}
                  tickFormatter={formatShortDate}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={24}
                />
                <YAxis tick={CHART_TICK} axisLine={false} tickLine={false} width={44} />
                <Tooltip
                  contentStyle={CHART_TOOLTIP_STYLE}
                  cursor={{ stroke: "rgba(255,255,255,0.08)" }}
                />
                <Area type="monotone" dataKey="calls" name="Calls" stroke={ACCENT} strokeWidth={1.8} fill="url(#today-calls)" animationDuration={500} />
                <Area type="monotone" dataKey="appointments" name="Appointments" stroke={SUCCESS} strokeWidth={1.8} fill="url(#today-appointments)" animationDuration={500} />
                <Area type="monotone" dataKey="orders" name="Orders" stroke={WARNING} strokeWidth={1.8} fill="url(#today-orders)" animationDuration={500} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-4 flex items-center gap-5 border-t border-line pt-4">
            {[
              { label: "Calls", color: ACCENT },
              { label: "Appointments", color: SUCCESS },
              { label: "Orders", color: WARNING },
            ].map((item) => (
              <span key={item.label} className="flex items-center gap-2 text-[12px] text-ink-low">
                <span className="h-2 w-2 rounded-full" style={{ background: item.color }} aria-hidden="true" />
                {item.label}
              </span>
            ))}
          </div>
        </Card>
      </motion.div>
    </div>
  );
}
