"use client";

import type { ReactNode } from "react";

export const CARD_SURFACE =
  "rounded-2xl border border-line bg-graphite-900 shadow-[0_1px_0_rgba(255,255,255,0.02)_inset,0_16px_40px_-20px_rgba(0,0,0,0.6)]";

export function Card({
  children,
  className = "",
  padding = true,
}: {
  children: ReactNode;
  className?: string;
  padding?: boolean;
}) {
  return (
    <div className={`${CARD_SURFACE} ${padding ? "p-6 sm:p-7" : ""} ${className}`}>{children}</div>
  );
}

export function CardHeader({
  title,
  hint,
  right,
}: {
  title: string;
  hint?: string;
  right?: ReactNode;
}) {
  return (
    <div className="mb-6 flex items-center justify-between gap-4">
      <div className="flex items-baseline gap-3">
        <h2 className="section-title">{title}</h2>
        {hint && <span className="text-[12px] text-ink-faint">{hint}</span>}
      </div>
      {right}
    </div>
  );
}
