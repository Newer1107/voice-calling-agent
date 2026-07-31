"use client";

import type { ReactNode } from "react";

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-left">{children}</table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return <thead>{children}</thead>;
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

export function TR({ children, className = "", onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  const interactive = onClick !== undefined;
  return (
    <tr
      onClick={onClick}
      className={`border-b border-line last:border-0 ${
        interactive
          ? "cursor-pointer transition-colors duration-150 hover:bg-white/[0.02]"
          : ""
      } ${className}`}
    >
      {children}
    </tr>
  );
}

export function TH({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return (
    <th
      className={`px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-low first:pl-0 last:pr-0 ${className}`}
    >
      {children}
    </th>
  );
}

export function TD({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return (
    <td className={`px-4 py-3.5 align-middle text-[13px] text-ink-mid first:pl-0 last:pr-0 ${className}`}>
      {children}
    </td>
  );
}
