"use client";

interface AgentStateProps {
  listening: boolean;
  speaking: boolean;
  thinking: boolean;
}

type Phase = "idle" | "listening" | "thinking" | "speaking";

const PHASE_META: Record<Phase, { label: string; bar: string; dot: string; pulse: boolean }> = {
  idle: { label: "Idle", bar: "bg-graphite-700", dot: "bg-ink-faint", pulse: false },
  listening: { label: "Listening", bar: "bg-accent", dot: "bg-accent animate-pulse-soft", pulse: true },
  thinking: { label: "Thinking", bar: "bg-warning", dot: "bg-warning animate-pulse-soft", pulse: true },
  speaking: { label: "Speaking", bar: "bg-success", dot: "bg-success animate-pulse-soft", pulse: true },
};

export function AgentState({ listening, speaking, thinking }: AgentStateProps) {
  const phase: Phase = speaking ? "speaking" : thinking ? "thinking" : listening ? "listening" : "idle";
  const meta = PHASE_META[phase];

  return (
    <section
      className="flex flex-col gap-4 rounded-2xl border border-line bg-graphite-900 p-7 shadow-[0_1px_0_rgba(255,255,255,0.02)_inset,0_16px_40px_-20px_rgba(0,0,0,0.6)]"
      aria-label="Agent state"
    >
      <div className="flex items-center justify-between">
        <h2 className="section-title">Agent State</h2>
        <span className="flex items-center gap-2 text-[12px] font-medium text-ink-mid">
          <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden="true" />
          {meta.label}
        </span>
      </div>

      <div className="flex gap-1.5" role="presentation">
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${
              meta.pulse && i < 3 ? `${meta.bar} animate-pulse-soft` : "bg-graphite-700"
            }`}
            style={meta.pulse && i < 3 ? { animationDelay: `${i * 140}ms` } : undefined}
          />
        ))}
      </div>

      <p className="text-[12px] leading-relaxed text-ink-faint">
        {phase === "idle" && "Waiting for input."}
        {phase === "listening" && "Microphone is open — speak now."}
        {phase === "thinking" && "Processing your request…"}
        {phase === "speaking" && "Audio reply in progress…"}
      </p>
    </section>
  );
}
