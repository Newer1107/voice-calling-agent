"use client";

import type { ErrorToast } from "@/hooks/use-voice-agent";

interface ErrorToastsProps {
  errors: ErrorToast[];
  onDismiss: (id: string) => void;
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function ErrorToasts({ errors, onDismiss }: ErrorToastsProps) {
  if (errors.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed right-4 top-4 z-50 flex w-full max-w-sm flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {errors.map((error) => (
        <div
          key={error.id}
          role={error.fatal ? "alert" : undefined}
          className={`pointer-events-auto flex items-start gap-3 rounded-lg border px-4 py-3 shadow-xl shadow-black/30 backdrop-blur-sm ${
            error.fatal
              ? "border-rose-500/50 bg-rose-950/80 text-rose-100"
              : "border-amber-500/40 bg-amber-950/80 text-amber-100"
          }`}
        >
          <div className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full border border-current text-[11px] font-bold">
            !
          </div>
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-baseline gap-x-2 text-sm font-semibold">
              <span className="font-mono text-xs uppercase tracking-wide opacity-70">
                {error.code}
              </span>
              <span className="text-xs text-white/50">
                {formatTime(error.timestamp)}
              </span>
            </p>
            <p className="mt-0.5 text-sm break-words text-white/85">{error.message}</p>
            {error.fatal && (
              <p className="mt-1 text-xs font-medium text-rose-300">
                Connection lost — press Connect to try again.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => onDismiss(error.id)}
            aria-label={`Dismiss error: ${error.message}`}
            className="flex-none rounded p-1 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
