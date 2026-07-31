"use client";

import { motion } from "framer-motion";

import { Sparkline } from "@/components/dashboard/sparkline";
import { Card } from "@/components/ui/card";
import type { SeriesPoint } from "@/lib/dashboard-api";

const ACCENT = "#3B82F6";

export function MetricCard({
  label,
  value,
  caption,
  series,
  color = ACCENT,
  index = 0,
}: {
  label: string;
  value: string;
  caption?: string;
  series: SeriesPoint[];
  color?: string;
  index?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: index * 0.03 }}
    >
      <Card className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium uppercase tracking-[0.08em] text-ink-low">
            {label}
          </span>
          <span className="text-[28px] font-semibold leading-none tracking-[-0.02em] text-ink-high tabular-nums">
            {value}
          </span>
          {caption && <span className="text-[12px] text-ink-faint">{caption}</span>}
        </div>
        <div className="-mx-1">
          <Sparkline data={series} color={color} />
        </div>
      </Card>
    </motion.div>
  );
}
