"use client";

import { motion } from "framer-motion";
import { useMemo, useState } from "react";

import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { useDashboard } from "@/lib/dashboard-store";
import { formatDate, formatTime } from "@/lib/format";

export default function AppointmentsPage() {
  const { state, loading } = useDashboard();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string>("all");

  const appointments = state.appointments ?? [];

  const statuses = useMemo(() => {
    const set = new Set<string>();
    for (const appointment of appointments) set.add(appointment.status);
    return [...set];
  }, [appointments]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return appointments.filter((appointment) => {
      if (status !== "all" && appointment.status !== status) return false;
      if (!q) return true;
      return (
        appointment.customer.toLowerCase().includes(q) ||
        appointment.session.toLowerCase().includes(q) ||
        appointment.bookingId.toLowerCase().includes(q)
      );
    });
  }, [appointments, query, status]);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Appointments"
        subtitle="Bookings the agent has confirmed for members and walk-ins."
        right={<span className="text-[12px] text-ink-faint">{filtered.length} shown</span>}
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <svg
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path d="m21 21-4.3-4.3M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search customer, service, booking…"
            aria-label="Search appointments"
            className="h-9 w-64 rounded-lg border border-line bg-graphite-850 pl-9 pr-3 text-[13px] text-ink-high placeholder:text-ink-faint focus:border-accent-border focus:outline-none"
          />
        </div>
        <Tabs
          tabs={[{ value: "all", label: "All", count: appointments.length }, ...statuses.map((s) => ({ value: s, label: s, count: appointments.filter((a) => a.status === s).length }))]}
          value={status}
          onChange={setStatus}
        />
      </div>

      {loading && state.appointments === null ? (
        <Card>
          <div className="flex flex-col gap-4">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        </Card>
      ) : filtered.length === 0 ? (
        <EmptyState
          title={appointments.length === 0 ? "No appointments yet" : "No appointments match"}
          hint={appointments.length === 0 ? "Bookings made through the voice agent appear here." : "Try a different search or filter."}
        />
      ) : (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
          <Card padding={false}>
            <div className="overflow-x-auto px-6 py-2 sm:px-7">
              <Table>
                <THead>
                  <TR className="border-none">
                    <TH>Status</TH>
                    <TH>Customer</TH>
                    <TH>Date</TH>
                    <TH>Time</TH>
                    <TH>Service</TH>
                    <TH>Booking ID</TH>
                  </TR>
                </THead>
                <TBody>
                  {filtered.map((appointment) => (
                    <TR key={appointment.id}>
                      <TD><StatusBadge status={appointment.status} /></TD>
                      <TD className="font-medium text-ink-high">{appointment.customer}</TD>
                      <TD className="whitespace-nowrap text-ink-high">{formatDate(appointment.date)}</TD>
                      <TD className="whitespace-nowrap font-mono tabular-nums">{appointment.time}</TD>
                      <TD className="text-ink-low">{appointment.session}</TD>
                      <TD className="whitespace-nowrap font-mono text-[12px] text-ink-faint">{appointment.bookingId}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          </Card>
        </motion.div>
      )}
    </div>
  );
}
