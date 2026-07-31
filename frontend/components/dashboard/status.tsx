"use client";

import { Badge, type BadgeTone } from "@/components/ui/badge";

const STATUS_TONES: Record<string, BadgeTone> = {
  confirmed: "success",
  completed: "success",
  paid: "success",
  success: "success",
  ok: "success",
  pending: "warning",
  awaiting: "warning",
  cancelled: "error",
  canceled: "error",
  refunded: "error",
  failed: "error",
  error: "error",
  expired: "warning",
};

export function StatusBadge({ status }: { status: string | null | undefined }) {
  const tone = STATUS_TONES[(status ?? "").toLowerCase()] ?? "neutral";
  return (
    <Badge tone={tone}>
      <span className="h-1 w-1 rounded-full bg-current opacity-70" aria-hidden="true" />
      {status ?? "—"}
    </Badge>
  );
}

const TIER_TONES: Record<string, BadgeTone> = {
  platinum: "accent",
  gold: "warning",
  silver: "neutral",
  bronze: "neutral",
  trial: "neutral",
};

export function TierBadge({ tier }: { tier: string | null | undefined }) {
  const tone = TIER_TONES[(tier ?? "").toLowerCase()] ?? "neutral";
  return <Badge tone={tone}>{tier ?? "—"}</Badge>;
}
