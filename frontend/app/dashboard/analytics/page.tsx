"use client";

import { motion } from "framer-motion";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { CHART_TICK, CHART_TOOLTIP_STYLE } from "@/components/dashboard/sparkline";
import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useDashboard } from "@/lib/dashboard-store";

const AXIS_PROPS = {
  tick: CHART_TICK,
  axisLine: false as const,
  tickLine: false as const,
  stroke: "var(--color-line)",
  fontSize: 10,
} as const;

function ChartCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader title={title} hint={hint} />
      <div className="mt-4 h-64 w-full">{children}</div>
    </Card>
  );
}

export default function AnalyticsPage() {
  const { state, loading } = useDashboard();

  const analytics = state.analytics;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Analytics"
        subtitle="Call volume, bookings, tool usage and peak hours over the last 14 days."
        right={
          analytics && (
            <span className="text-[12px] text-ink-faint">
              Satisfaction <span className="font-semibold text-ink-mid">{analytics.satisfaction}%</span>
            </span>
          )
        }
      />

      {loading && analytics === null ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Card key={i}>
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="mt-4 h-52 w-full" />
            </Card>
          ))}
        </div>
      ) : !analytics ? (
        <EmptyState title="No analytics yet" hint="Trends will appear once the agent has handled some calls." />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
            <ChartCard title="Calls per day" hint="inbound call volume">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={analytics.callsPerDay} margin={{ top: 4, right: 4, bottom: 0, left: -22 }}>
                  <defs>
                    <linearGradient id="calls-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.28} />
                      <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--color-line)" strokeDasharray="4 6" vertical={false} />
                  <XAxis dataKey="date" {...AXIS_PROPS} />
                  <YAxis {...AXIS_PROPS} allowDecimals={false} />
                  <Tooltip contentStyle={CHART_TOOLTIP_STYLE} labelStyle={{ color: "var(--color-ink-mid)", fontSize: 11 }} />
                  <Area
                    type="monotone"
                    dataKey="count"
                    name="calls"
                    stroke="var(--color-accent)"
                    strokeWidth={1.6}
                    fill="url(#calls-fill)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>
          </motion.div>

          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2, delay: 0.04 }}>
            <ChartCard title="Bookings & orders" hint="appointments and orders per day">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={analytics.appointments} margin={{ top: 4, right: 4, bottom: 0, left: -22 }}>
                  <defs>
                    <linearGradient id="orders-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-success)" stopOpacity={0.22} />
                      <stop offset="100%" stopColor="var(--color-success)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--color-line)" strokeDasharray="4 6" vertical={false} />
                  <XAxis dataKey="date" {...AXIS_PROPS} />
                  <YAxis {...AXIS_PROPS} allowDecimals={false} />
                  <Tooltip contentStyle={CHART_TOOLTIP_STYLE} labelStyle={{ color: "var(--color-ink-mid)", fontSize: 11 }} />
                  <Area
                    type="monotone"
                    dataKey="count"
                    name="appointments"
                    stroke="var(--color-accent)"
                    strokeWidth={1.6}
                    fill="var(--color-accent-soft)"
                  />
                  <Area
                    type="monotone"
                    dataKey="count"
                    name="orders"
                    stroke="var(--color-success)"
                    strokeWidth={1.6}
                    fill="url(#orders-fill)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>
          </motion.div>

          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2, delay: 0.08 }}>
            <ChartCard title="Tool usage" hint="webhook tools the agent invoked">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analytics.toolUsage} margin={{ top: 4, right: 4, bottom: 0, left: -22 }}>
                  <CartesianGrid stroke="var(--color-line)" strokeDasharray="4 6" vertical={false} />
                  <XAxis dataKey="tool" {...AXIS_PROPS} interval={0} angle={-18} textAnchor="end" height={54} />
                  <YAxis {...AXIS_PROPS} allowDecimals={false} />
                  <Tooltip contentStyle={CHART_TOOLTIP_STYLE} labelStyle={{ color: "var(--color-ink-mid)", fontSize: 11 }} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                  <Bar dataKey="count" name="calls" fill="var(--color-accent)" fillOpacity={0.75} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </motion.div>

          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2, delay: 0.12 }}>
            <ChartCard title="Peak hours" hint="busiest hours of the day">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analytics.peakHours} margin={{ top: 4, right: 4, bottom: 0, left: -22 }}>
                  <CartesianGrid stroke="var(--color-line)" strokeDasharray="4 6" vertical={false} />
                  <XAxis dataKey="hour" {...AXIS_PROPS} tickFormatter={(h: number) => `${h}:00`} />
                  <YAxis {...AXIS_PROPS} allowDecimals={false} />
                  <Tooltip contentStyle={CHART_TOOLTIP_STYLE} labelStyle={{ color: "var(--color-ink-mid)", fontSize: 11 }} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                  <Bar dataKey="count" name="calls" fill="var(--color-accent)" fillOpacity={0.75} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </motion.div>
        </div>
      )}
    </div>
  );
}
