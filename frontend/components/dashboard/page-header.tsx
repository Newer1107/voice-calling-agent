"use client";

import type { ReactNode } from "react";

export function PageHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
      <div className="max-w-2xl">
        <h1 className="text-[26px] font-bold leading-tight tracking-[-0.02em] text-ink-high">
          {title}
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-ink-low">{subtitle}</p>
      </div>
      {right && <div className="flex items-center gap-3 pt-1">{right}</div>}
    </div>
  );
}
