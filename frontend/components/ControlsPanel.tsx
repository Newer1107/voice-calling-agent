"use client";

import { useEffect, useRef } from "react";

import type { ListenState } from "@/hooks/use-voice-agent";

interface ControlsPanelProps {
  connected: boolean;
  listening: ListenState;
  speaking: boolean;
  thinking: boolean;
  vadEnabled: boolean;
  pttHeld: boolean;
  micEnabled: boolean;
  agentName: string;
  onStartPtt: () => void;
  onStopPtt: () => void;
  onToggleVad: () => void;
}

interface LedProps {
  label: string;
  on: boolean;
  onClasses: string;
  offClasses: string;
}

function Led({ label, on, onClasses, offClasses }: LedProps) {
  return (
    <span
      className={`led ${on ? `led-on ${onClasses}` : offClasses}`}
      role="status"
      aria-label={`${label} ${on ? "active" : "inactive"}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${on ? "bg-current" : "bg-current opacity-40"}`}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

/** Any interactive control that should keep native Space/Enter behavior. */
function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "BUTTON" ||
    target.tagName === "A" ||
    target.getAttribute("role") === "button" ||
    target.getAttribute("role") === "switch"
  );
}

export function ControlsPanel({
  connected,
  listening,
  speaking,
  thinking,
  vadEnabled,
  pttHeld,
  micEnabled,
  agentName,
  onStartPtt,
  onStopPtt,
  onToggleVad,
}: ControlsPanelProps) {
  const heldRef = useRef(false);

  // Space-bar hold-to-talk. Window-level keyup + blur so releasing the key
  // (or losing focus) anywhere always ends the push.
  useEffect(() => {
    if (!connected) return;

    const end = () => {
      if (heldRef.current) {
        heldRef.current = false;
        onStopPtt();
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      if (isTypingTarget(event.target) || isInteractiveTarget(event.target)) return;
      // preventDefault on repeats too — holding Space must not scroll the page.
      event.preventDefault();
      if (event.repeat || heldRef.current) return;
      heldRef.current = true;
      onStartPtt();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      if (isTypingTarget(event.target) || isInteractiveTarget(event.target)) return;
      event.preventDefault();
      end();
    };
    const onWindowBlur = () => end();

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onWindowBlur);
      end();
    };
  }, [connected, onStartPtt, onStopPtt]);

  const handlePointerStart = () => {
    if (!connected || heldRef.current) return;
    heldRef.current = true;
    onStartPtt();
  };
  const handlePointerEnd = () => {
    if (!heldRef.current) return;
    heldRef.current = false;
    onStopPtt();
  };
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if ((event.key === "Enter" || event.code === "Space") && !event.repeat) {
      event.preventDefault();
      handlePointerStart();
    }
  };
  const handleKeyUp = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" || event.code === "Space") {
      event.preventDefault();
      handlePointerEnd();
    }
  };

  return (
    <section className="panel" aria-label="Controls">
      <div className="panel-header">
        <h2 className="panel-title">Controls</h2>
        <span
          className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${
            micEnabled ? "text-emerald-300" : "text-slate-500"
          }`}
          aria-label={`Microphone ${micEnabled ? "on" : "off"}`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              micEnabled ? "bg-emerald-400" : "bg-slate-600"
            }`}
            aria-hidden="true"
          />
          Mic {micEnabled ? "on" : "off"}
        </span>
      </div>

      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Agent state">
          <Led
            label="Listening"
            on={listening.active}
            onClasses="border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
            offClasses="border-white/10 bg-white/5 text-slate-500"
          />
          <Led
            label="Speaking"
            on={speaking}
            onClasses="border-voice-500/50 bg-voice-500/10 text-voice-300"
            offClasses="border-white/10 bg-white/5 text-slate-500"
          />
          <Led
            label="Thinking"
            on={thinking}
            onClasses="border-amber-500/50 bg-amber-500/10 text-amber-300"
            offClasses="border-white/10 bg-white/5 text-slate-500"
          />
        </div>

        <button
          type="button"
          role="button"
          aria-pressed={pttHeld}
          aria-keyshortcuts="Space"
          aria-label="Push to talk — hold to speak"
          disabled={!connected}
          onPointerDown={(e) => {
            // Capture so a held PTT survives the pointer drifting off the button.
            e.currentTarget.setPointerCapture(e.pointerId);
            handlePointerStart();
          }}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          onLostPointerCapture={handlePointerEnd}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          className={`w-full select-none rounded-xl border px-4 py-6 text-sm font-semibold transition-all active:scale-[0.98] disabled:opacity-40 ${
            pttHeld
              ? "border-rose-500/60 bg-rose-500/20 text-rose-200 shadow-lg shadow-rose-950/40"
              : "border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
          }`}
        >
          {!connected ? (
            "Connect to speak"
          ) : pttHeld ? (
            <>
              <span className="mr-2 inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-rose-400" />
              Listening — release to stop
            </>
          ) : (
            "Push to talk (hold)"
          )}
        </button>

        <div className="flex items-center justify-between gap-3">
          <label htmlFor="vad-toggle" className="label">
            Voice-activity detection
          </label>
          <button
            type="button"
            id="vad-toggle"
            role="switch"
            aria-checked={vadEnabled}
            aria-label="Toggle voice-activity detection"
            onClick={onToggleVad}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.code === "Space") {
                event.preventDefault();
                onToggleVad();
              }
            }}
            className={`relative h-6 w-11 flex-none rounded-full border transition-colors ${
              vadEnabled
                ? "border-brand-500/60 bg-brand-500/80"
                : "border-white/10 bg-white/10"
            }`}
          >
            <span
              className={`absolute top-0.5 rounded-full bg-white shadow transition-all ${
                vadEnabled ? "left-[22px]" : "left-0.5"
              }`}
              style={{ height: "1.125rem", width: "1.125rem" }}
            />
          </button>
        </div>

        <p className="text-[11px] leading-relaxed text-slate-500">
          Talk to <span className="text-slate-300">{agentName}</span>. Hold
          <kbd className="mx-1 rounded border border-white/15 bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-slate-200">
            Space
          </kbd>
          to speak, or enable VAD to talk hands-free.
        </p>
      </div>
    </section>
  );
}
