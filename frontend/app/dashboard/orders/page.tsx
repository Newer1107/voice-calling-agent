"use client";

import { motion } from "framer-motion";
import { useMemo, useState } from "react";

import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useDashboard } from "@/lib/dashboard-store";
import { formatCurrency, formatDate, formatTime } from "@/lib/format";

export default function OrdersPage() {
  const { state, loading } = useDashboard();
  const [query, setQuery] = useState("");

  const orders = state.orders ?? [];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter(
      (order) =>
        order.orderId.toLowerCase().includes(q) ||
        order.customer.toLowerCase().includes(q) ||
        order.items.some((item) => item.name.toLowerCase().includes(q)),
    );
  }, [orders, query]);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Orders"
        subtitle="Merchandise and services sold over the phone."
        right={<span className="text-[12px] text-ink-faint">{filtered.length} orders</span>}
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
          placeholder="Search order, customer, item…"
          aria-label="Search orders"
          className="h-9 w-64 rounded-lg border border-line bg-graphite-850 pl-9 pr-3 text-[13px] text-ink-high placeholder:text-ink-faint focus:border-accent-border focus:outline-none"
        />
      </div>

      {loading && state.orders === null ? (
        <Card>
          <div className="flex flex-col gap-4">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        </Card>
      ) : filtered.length === 0 ? (
        <EmptyState
          title={orders.length === 0 ? "No orders yet" : "No orders match"}
          hint={orders.length === 0 ? "Orders the agent takes over the phone appear here." : "Try a different search."}
        />
      ) : (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
          <Card padding={false}>
            <div className="overflow-x-auto px-6 py-2 sm:px-7">
              <Table>
                <THead>
                  <TR className="border-none">
                    <TH>Order</TH>
                    <TH>Customer</TH>
                    <TH>Items</TH>
                    <TH>Status</TH>
                    <TH>Total</TH>
                    <TH>Placed</TH>
                  </TR>
                </THead>
                <TBody>
                  {filtered.map((order) => (
                    <TR key={order.id}>
                      <TD className="whitespace-nowrap font-mono text-[12px] text-ink-low">{order.orderId}</TD>
                      <TD className="font-medium text-ink-high">{order.customer}</TD>
                      <TD className="max-w-[300px] text-ink-low">
                        <span className="flex flex-wrap gap-x-2 gap-y-1">
                          {order.items.map((item) => (
                            <span key={item.name}>
                              <span className="font-mono tabular-nums text-ink-mid">{item.quantity}×</span> {item.name}
                            </span>
                          ))}
                        </span>
                      </TD>
                      <TD><StatusBadge status={order.status} /></TD>
                      <TD className="whitespace-nowrap font-semibold tabular-nums text-ink-high">
                        {formatCurrency(order.total)}
                      </TD>
                      <TD className="whitespace-nowrap text-ink-faint">
                        {formatDate(order.createdAt)} · {formatTime(order.createdAt)}
                      </TD>
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
