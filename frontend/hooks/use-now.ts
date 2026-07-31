"use client";

import { useEffect, useState } from "react";

/** Current epoch ms, re-rendering every `intervalMs` — for ticking timers. */
export function useNow(intervalMs = 1_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
