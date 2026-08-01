"use client";

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

import { DashboardProvider, useDashboard } from "@/lib/dashboard-store";
import type { ServiceHealth, ServiceName } from "@/lib/dashboard-api";

// ---------------------------------------------------------------------------
// Icons (inline, stroke-matched to the console's iconography)
// ---------------------------------------------------------------------------

function Icon({ d, className = "h-4 w-4" }: { d: string; className?: string }) {
  return (
    <svg
      className={`flex-none ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path d={d} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const NAV_ICONS = {
  overview: "M4 4h7v7H4V4Zm9 0h7v4h-7V4Zm0 6h7v10h-7V10ZM4 13h7v7H4v-7Z",
  live: "M3 12a9 9 0 0 1 18 0M7 12a5 5 0 0 1 10 0m-13 0a13 13 0 0 0 13 9",
  history: "M12 7v5l3 2m6-2a9 9 0 1 1-3.2-6.9M4 4v5h5",
  appointments: "M8 2v4m8-4v4M4 8h16M5 4h14a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm4 9h6m-6 4h4",
  orders: "M6 3h12l2 4v14H4V7l2-4Zm0 4h12M9 11a3 3 0 0 0 6 0",
  customers: "M17 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1m14-8a3.5 3.5 0 1 0-4-5.5M21 20v-1a4 4 0 0 0-3-3.9",
  analytics: "M4 20V10m6 10V4m6 16v-7m4 7H2",
  stats: "M3 12h4l2-6 4 12 2-6h6",
  system: "M5 8a7 7 0 0 1 14 0M4 8h16v3a8 8 0 0 1-16 0V8Zm9 3h-2v7a2 2 0 0 0 4 0v-7Z",
} as const;

const NAV: { href: string; label: string; icon: keyof typeof NAV_ICONS }[] = [
  { href: "/dashboard", label: "Overview", icon: "overview" },
  { href: "/dashboard/conversations", label: "Live Conversations", icon: "live" },
  { href: "/dashboard/history", label: "History", icon: "history" },
  { href: "/dashboard/appointments", label: "Appointments", icon: "appointments" },
  { href: "/dashboard/orders", label: "Orders", icon: "orders" },
  { href: "/dashboard/customers", label: "Customers", icon: "customers" },
  { href: "/dashboard/analytics", label: "Analytics", icon: "analytics" },
  { href: "/dashboard/stats", label: "Statistics", icon: "stats" },
  { href: "/dashboard/system", label: "System", icon: "system" },
];

// ---------------------------------------------------------------------------
// System status pill (sidebar footer) + WS status dot
// ---------------------------------------------------------------------------

function healthOf(services: Partial<Record<ServiceName, ServiceHealth>> | undefined) {
  if (!services) return { tone: "neutral", label: "Connecting…" } as const;
  const values = Object.values(services);
  if (values.some((v) => v === "down"))
    return { tone: "error", label: "Service down" } as const;
  if (values.some((v) => v === "degraded"))
    return { tone: "warning", label: "Degraded" } as const;
  if (values.length === 0) return { tone: "neutral", label: "Unknown" } as const;
  return { tone: "success", label: "All systems operational" } as const;
}

const DOT_TONES = {
  neutral: "bg-ink-faint",
  success: "bg-success",
  warning: "bg-warning animate-pulse-soft",
  error: "bg-error",
} as const;

function Brand() {
  return (
    <Link href="/dashboard" className="flex items-center gap-3">
      <span className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15">
        <span className="h-2.5 w-2.5 rounded-full bg-accent" aria-hidden="true" />
        <span className="absolute inset-0 rounded-lg ring-1 ring-inset ring-accent/25" aria-hidden="true" />
      </span>
      <span className="flex flex-col leading-none">
        <span className="text-[15px] font-semibold tracking-tight text-ink-high">IronPeak</span>
        <span className="mt-1 text-[10px] font-medium uppercase tracking-[0.14em] text-ink-faint">
          Reception Desk
        </span>
      </span>
    </Link>
  );
}

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Dashboard">
      {NAV.map((item) => {
        const active =
          item.href === "/dashboard"
            ? pathname === "/dashboard"
            : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors duration-150 ${
              active
                ? "bg-white/[0.05] text-ink-high"
                : "text-ink-low hover:bg-white/[0.03] hover:text-ink-mid"
            }`}
          >
            <Icon d={NAV_ICONS[item.icon]} className={active ? "h-4 w-4 text-accent" : "h-4 w-4"} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function StatusPill() {
  const { state } = useDashboard();
  const health = healthOf(state.system?.services);
  return (
    <Link
      href="/dashboard/system"
      className="flex items-center gap-2.5 rounded-lg border border-line bg-graphite-900 px-3 py-2.5 transition-colors duration-150 hover:bg-graphite-850"
    >
      <span className={`h-2 w-2 flex-none rounded-full ${DOT_TONES[health.tone]}`} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-medium text-ink-mid">{health.label}</span>
        <span className="block text-[10px] text-ink-faint">LiveKit · Ollama · n8n</span>
      </span>
    </Link>
  );
}

function WsDot() {
  const { wsStatus } = useDashboard();
  const live = wsStatus === "open";
  return (
    <span className="flex items-center gap-2 text-[12px] font-medium text-ink-low">
      <span
        className={`h-2 w-2 rounded-full ${live ? "bg-success" : wsStatus === "connecting" ? "bg-warning animate-pulse-soft" : "bg-ink-faint"}`}
        aria-hidden="true"
      />
      {live ? "Live" : wsStatus === "connecting" ? "Connecting" : wsStatus === "reconnecting" ? "Reconnecting" : "Offline"}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <div className="flex h-full flex-col">
      <div className="px-4 pb-8 pt-6">
        <Brand />
      </div>
      <div className="flex-1 px-3">
        <NavLinks pathname={pathname} onNavigate={onNavigate} />
      </div>
      <div className="px-3 pb-4">
        <StatusPill />
      </div>
    </div>
  );
}

function DashboardShell({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();

  return (
    <div className="min-h-dvh bg-graphite-950">
      {/* Desktop sidebar — same canvas background, border-only separation. */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 border-r border-line lg:block">
        <SidebarContent />
      </aside>

      {/* Mobile top bar + drawer. */}
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-line bg-graphite-950/90 px-4 backdrop-blur lg:hidden">
        <Brand />
        <div className="flex items-center gap-4">
          <WsDot />
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
            className="icon-btn"
          >
            <Icon d="M4 6h16M4 12h16M4 18h16" />
          </button>
        </div>
      </header>

      <AnimatePresence>
        {drawerOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <motion.div
              className="absolute inset-0 bg-black/60"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              onClick={() => setDrawerOpen(false)}
              aria-hidden="true"
            />
            <motion.div
              className="absolute inset-y-0 left-0 w-64 border-r border-line bg-graphite-950"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              <SidebarContent onNavigate={() => setDrawerOpen(false)} />
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Main column. */}
      <main key={pathname} className="lg:pl-60">
        <div className="mx-auto max-w-[1240px] px-5 py-10 sm:px-8 lg:px-12">
          {children}
        </div>
      </main>
    </div>
  );
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <DashboardProvider>
      <DashboardShell>{children}</DashboardShell>
    </DashboardProvider>
  );
}
