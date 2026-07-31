"use client";

export function EmptyState({
  title,
  hint,
}: {
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2.5 rounded-2xl border border-dashed border-line-strong bg-graphite-900/50 px-6 py-16 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-graphite-850 text-ink-low" aria-hidden="true">
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 8v5m0 3.5v.01M10.3 4.4 3.6 16a2 2 0 0 0 1.7 3h13.4a2 2 0 0 0 1.7-3L13.7 4.4a2 2 0 0 0-3.4 0Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <p className="text-[14px] font-medium text-ink-mid">{title}</p>
      {hint && <p className="max-w-sm text-[12px] leading-relaxed text-ink-faint">{hint}</p>}
    </div>
  );
}
