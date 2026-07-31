"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Wall-clock elapsed time since `connected` became true; resets to 0 when
 * disconnected. Derived client-side — no backend involvement.
 */
export function useSessionDuration(connected: boolean): number {
  const [elapsedMs, setElapsedMs] = useState(0);
  const startedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (connected) {
      startedAtRef.current ??= Date.now();
    } else {
      startedAtRef.current = null;
    }
    setElapsedMs(0);
  }, [connected]);

  useEffect(() => {
    if (!connected) return;
    const timer = setInterval(() => {
      const started = startedAtRef.current;
      if (started !== null) setElapsedMs(Date.now() - started);
    }, 1000);
    return () => clearInterval(timer);
  }, [connected]);

  return elapsedMs;
}
