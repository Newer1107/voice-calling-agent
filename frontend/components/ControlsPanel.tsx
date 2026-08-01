"use client";

import { useEffect, useState } from "react";

interface ControlsPanelProps {
  connected: boolean;
  listening: boolean;
  speaking: boolean;
  thinking: boolean;
  vadEnabled: boolean;
  pttHeld: boolean;
  micEnabled: boolean;
  agentName: string;
  onStartPtt: () => void;
  onStopPtt: () => void;
  onToggleVad: (enabled: boolean) => void;
}

export function ControlsPanel({
  connected,
  listening,
  speaking,
  thinking,
  vadEnabled,
  pttHeld,
  micEnabled,
  onStartPtt,
  onStopPtt,
  onToggleVad,
}: ControlsPanelProps) {
  // Hold-Space push-to-talk. Keyup fires on the same key in any state; only
  // stop when it was actually held (guards against stuck-hold after blur).
  useEffect(() => {
    if (!connected) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.metaKey || e.ctrlKey || e.altKey) return;
      // preventDefault on repeats too — holding Space must never scroll the page.
      e.preventDefault();
      if (e.repeat) return;
      onStartPtt();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        onStopPtt();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [connected, onStartPtt, onStopPtt]);

  const [coarsePointer, setCoarsePointer] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    setCoarsePointer(window.matchMedia("(pointer: coarse)").matches);
  }, []);

  const pttActive = pttHeld || listening;
  const stateLabel = !connected
    ? "Disconnected"
    : speaking
      ? "Agent speaking…"
      : thinking
        ? "Agent thinking…"
        : pttActive
          ? "Listening…"
          : vadEnabled
            ? "Voice activity"
            : "Standby";

  const stateTone = speaking
    ? "bg-warning/15 text-warning"
    : thinking || pttActive
      ? "bg-accent/15 text-accent-soft"
      : "bg-white/[0.05] text-ink-low";

  return (
    <section
      className="flex flex-col gap-5 rounded-2xl border border-line bg-graphite-900 p-7 shadow-[0_1px_0_rgba(255,255,255,0.02)_inset,0_16px_40px_-20px_rgba(0,0,0,0.6)]"
      aria-label="Voice controls"
    >
      <div className="flex items-center justify-between">
        <h2 className="section-title">Voice Controls</h2>
        <span
          className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium tracking-wide ${stateTone}`}
        >
          {stateLabel}
        </span>
      </div>

      {/* Mic button — pulse ring while listening, filled while speaking. */}
      <div className="flex flex-col items-center gap-4 py-1">
        <button
          type="button"
          disabled={!connected || !micEnabled || speaking}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            onStartPtt();
          }}
          onPointerUp={onStopPtt}
          onPointerCancel={onStopPtt}
          onContextMenu={(e) => e.preventDefault()}
          aria-label={
            pttActive ? "Release to stop talking" : "Hold to talk"
          }
          className="group relative flex h-20 w-20 touch-none select-none items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pttActive && (
            <span
              className="absolute inset-0 animate-pulse-ring rounded-full border border-accent/60"
              aria-hidden="true"
            />
          )}
          <span
            className={`flex h-16 w-16 items-center justify-center rounded-full border transition-colors duration-150 ${
              speaking
                ? "border-warning/60 bg-warning/15 text-warning"
                : pttActive
                  ? "border-accent bg-accent text-white"
                  : "border-line-strong bg-graphite-850 text-ink-mid group-hover:border-accent/50 group-hover:text-ink-high"
            }`}
          >
            <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Zm-6 9a6 6 0 0 0 12 0M12 17v4m-3 0h6"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </button>
        <p className="text-[12px] text-ink-faint">
          {!connected ? (
            "Connect to start"
          ) : pttActive ? (
            "Release to send"
          ) : vadEnabled ? (
            coarsePointer ? (
              "Voice activity — hold the mic to override"
            ) : (
              <>
                Voice activity — hold <kbd className="kbd">Space</kbd> to override
              </>
            )
          ) : coarsePointer ? (
            "Hold the mic to talk"
          ) : (
            <>
              Hold <kbd className="kbd">Space</kbd> to talk
            </>
          )}
        </p>
      </div>

      {/* Input mode segmented control — mirrors the old toggle, clearer. */}
      <div
        className="flex rounded-lg border border-line bg-graphite-850 p-1"
        role="group"
        aria-label="Input mode"
      >
        <button
          type="button"
          disabled={!connected}
          onClick={() => onToggleVad(false)}
          aria-pressed={!vadEnabled}
          className={`flex-1 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${
            !vadEnabled
              ? "bg-graphite-700 text-ink-high shadow-sm"
              : "text-ink-low hover:text-ink-high"
          }`}
        >
          Push-to-talk
        </button>
        <button
          type="button"
          disabled={!connected}
          onClick={() => onToggleVad(true)}
          aria-pressed={vadEnabled}
          className={`flex-1 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${
            vadEnabled
              ? "bg-graphite-700 text-ink-high shadow-sm"
              : "text-ink-low hover:text-ink-high"
          }`}
        >
          Voice activity
        </button>
      </div>
    </section>
  );
}
