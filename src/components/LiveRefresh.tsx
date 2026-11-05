"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-reads the page every few seconds for a while, so news from PayPal's webhooks shows up without a reload. */
export function LiveRefresh({ everyMs = 8000, forMs = 180_000 }: { everyMs?: number; forMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - started > forMs) clearInterval(timer);
      else router.refresh();
    }, everyMs);
    return () => clearInterval(timer);
  }, [router, everyMs, forMs]);
  return null;
}
