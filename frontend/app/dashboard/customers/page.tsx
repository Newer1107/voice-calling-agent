"use client";

import { motion } from "framer-motion";
import { useMemo, useState } from "react";

import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { TierBadge } from "@/components/dashboard/status";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { Customer } from "@/lib/dashboard-api";
import { useDashboard } from "@/lib/dashboard-store";
import { formatCurrency, formatDate } from "@/lib/format";

function ProfileDialog({
  customer,
  onClose,
}: {
  customer: Customer | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={customer !== null} onClose={onClose} title={customer?.name ?? "Customer"} wide>
      {customer && (
        <div className="flex flex-col gap-7">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[12px] text-ink-low">
            <span className="flex items-center gap-2 text-ink-mid">
              <TierBadge tier={customer.tier} />
              <span>{customer.membershipStatus}</span>
            </span>
            {customer.lastVisit && <span>last visit {formatDate(customer.lastVisit)}</span>}
          </div>

          <section aria-label="Stats">
            <h3 className="section-title mb-4">Stats</h3>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Visits", value: String(customer.visits) },
                { label: "Lifetime value", value: formatCurrency(customer.ltv) },
                { label: "Tier", value: customer.tier },
              ].map((stat) => (
                <div key={stat.label} className="rounded-lg border border-line bg-graphite-850 px-4 py-3">
                  <p className="text-[11px] uppercase tracking-wider text-ink-faint">{stat.label}</p>
                  <p className="mt-1 text-[16px] font-semibold tabular-nums capitalize text-ink-high">{stat.value}</p>
                </div>
              ))}
            </div>
          </section>

          <section aria-label="Upcoming booking">
            <h3 className="section-title mb-4">Upcoming booking</h3>
            {customer.upcomingBooking ? (
              <div className="flex items-center gap-3 rounded-lg border border-line bg-graphite-850 px-3.5 py-2.5">
                <span className="h-1.5 w-1.5 flex-none rounded-full bg-accent" aria-hidden="true" />
                <span className="text-[13px] text-ink-high">{customer.upcomingBooking.session}</span>
                <span className="ml-auto text-[12px] text-ink-faint">
                  {formatDate(customer.upcomingBooking.date)} · {customer.upcomingBooking.time}
                </span>
              </div>
            ) : (
              <p className="text-[12px] text-ink-faint">Nothing booked.</p>
            )}
          </section>
        </div>
      )}
    </Dialog>
  );
}

export default function CustomersPage() {
  const { state, loading } = useDashboard();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Customer | null>(null);

  const customers = state.customers ?? [];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (customer) =>
        customer.name.toLowerCase().includes(q) ||
        customer.tier.toLowerCase().includes(q) ||
        customer.membershipStatus.toLowerCase().includes(q),
    );
  }, [customers, query]);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Customers"
        subtitle="Everyone the agent has talked to, with their profile at a glance."
        right={<span className="text-[12px] text-ink-faint">{filtered.length} customers</span>}
      />

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
          placeholder="Search name, tier, membership…"
          aria-label="Search customers"
          className="h-9 w-64 rounded-lg border border-line bg-graphite-850 pl-9 pr-3 text-[13px] text-ink-high placeholder:text-ink-faint focus:border-accent-border focus:outline-none"
        />
      </div>

      {loading && state.customers === null ? (
        <Card>
          <div className="flex flex-col gap-4">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        </Card>
      ) : filtered.length === 0 ? (
        <EmptyState
          title={customers.length === 0 ? "No customers yet" : "No customers match"}
          hint={customers.length === 0 ? "Identified callers are saved here as profiles." : "Try a different search."}
        />
      ) : (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
          <Card padding={false}>
            <div className="overflow-x-auto px-6 py-2 sm:px-7">
              <Table>
                <THead>
                  <TR className="border-none">
                    <TH>Customer</TH>
                    <TH>Tier</TH>
                    <TH>Membership</TH>
                    <TH>Visits</TH>
                    <TH>Lifetime Value</TH>
                    <TH>Upcoming</TH>
                  </TR>
                </THead>
                <TBody>
                  {filtered.map((customer) => (
                    <TR key={customer.id} onClick={() => setSelected(customer)}>
                      <TD className="font-medium text-ink-high">{customer.name}</TD>
                      <TD><TierBadge tier={customer.tier} /></TD>
                      <TD className="text-ink-low">
                        <Badge tone="neutral">{customer.membershipStatus}</Badge>
                      </TD>
                      <TD className="font-mono tabular-nums text-ink-mid">{customer.visits}</TD>
                      <TD className="whitespace-nowrap font-semibold tabular-nums text-ink-high">{formatCurrency(customer.ltv)}</TD>
                      <TD className="max-w-[220px] truncate text-ink-low">
                        {customer.upcomingBooking ? (
                          <span>
                            {customer.upcomingBooking.session} · {formatDate(customer.upcomingBooking.date)}
                          </span>
                        ) : (
                          <span className="text-ink-faint">—</span>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          </Card>
        </motion.div>
      )}

      <ProfileDialog customer={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
