"use client";

interface TabsProps<T extends string> {
  tabs: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (value: T) => void;
}

/** Segmented control — the dashboard's tab primitive. */
export function Tabs<T extends string>({ tabs, value, onChange }: TabsProps<T>) {
  return (
    <div
      role="tablist"
      className="inline-flex items-center gap-0.5 rounded-lg border border-line bg-graphite-850 p-0.5"
    >
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.value)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors duration-150 ${
              active
                ? "bg-graphite-700 text-ink-high"
                : "text-ink-low hover:text-ink-mid"
            }`}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className={`text-[11px] tabular-nums ${active ? "text-ink-low" : "text-ink-faint"}`}>
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
