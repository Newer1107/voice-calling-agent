"use client";

import { Area, AreaChart, ResponsiveContainer, Tooltip } from "recharts";

import type { SeriesPoint } from "@/lib/dashboard-api";

export const CHART_TOOLTIP_STYLE = {
  background: "#1B1B1F",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 8,
  fontSize: 12,
  color: "#F2F2F4",
  boxShadow: "0 8px 24px -8px rgba(0,0,0,0.6)",
  padding: "8px 10px",
} as const;

export const CHART_TICK = { fontSize: 11, fill: "#6E6E78" } as const;

function SparklineTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value?: number | string }>;
  label?: string | number;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const value = payload[0]?.value;
  return (
    <div style={CHART_TOOLTIP_STYLE}>
      <span className="text-[11px] text-ink-faint">{label}</span>
      <span className="ml-2 font-mono tabular-nums text-ink-high">{value}</span>
    </div>
  );
}

export function Sparkline({
  data,
  color,
  height = 40,
}: {
  data: SeriesPoint[];
  color: string;
  height?: number;
}) {
  const id = `spark-${color.replace("#", "")}`;
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.22} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Tooltip content={<SparklineTooltip />} cursor={false} />
          <Area
            type="monotone"
            dataKey="count"
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#${id})`}
            animationDuration={500}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
