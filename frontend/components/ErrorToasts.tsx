"use client";

import { useEffect } from "react";

import type { ErrorToast } from "@/hooks/use-voice-agent";

interface ErrorToastsProps {
  errors: ErrorToast[];
  onDismiss: (id: string) => void;
}

export function ErrorToasts({ errors, onDismiss }: ErrorToastsProps) {
  // Auto-dismiss non-fatal errors after 8s; fatal ones need explicit dismissal.
  useEffect(() => {
    if (errors.length === 0) return;
    const timers = errors
      .filter((err) => !err.fatal)
      .map((err) => setTimeout(() => onDismiss(err.id), 8000));
    return () => timers.forEach(clearTimeout);
  }, [errors, onDismiss]);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex flex-col items-center gap-2 px-6"
      role="status"
      aria-live="polite"
    >
      {errors.map((err) => (
        <div
          key={err.id}
          className="pointer-events-auto flex w-full max-w-md animate-slide-up items-start gap-3 rounded-xl border border-error/40 bg-graphite-850 px-4 py-3 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.7)]"
        >
          <svg
            className="mt-0.5 h-4 w-4 flex-none text-error"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M12 8v5m0 3h.01M10.3 4.5 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.5a2 2 0 0 0-3.4 0Z"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-ink-high">{err.message}</p>
            {err.code && <p className="mt-0.5 text-[11px] text-ink-faint">{err.code}</p>}
          </div>
          <button
            type="button"
            onClick={() => onDismiss(err.id)}
            aria-label="Dismiss"
            className="icon-btn"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
