"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Action = "accept" | "escalate" | "refresh" | "demo";

export function CaseActions({
  caseId,
  mode,
  offerLabel,
  recommended,
  canPlayStore = false,
}: {
  caseId: string;
  mode: "decide" | "escalated";
  offerLabel?: string;
  recommended?: "accept" | "escalate";
  canPlayStore?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: Action) {
    setBusy(action);
    setError(null);
    const url =
      action === "refresh" ? `/api/cases/${caseId}/refresh` : action === "demo" ? `/api/cases/${caseId}/demo-store-accepts` : `/api/cases/${caseId}/decision`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: action === "accept" || action === "escalate" ? JSON.stringify({ action }) : undefined,
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "PayPal did not accept that.");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const primary = "rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper disabled:opacity-50";
  const secondary = "rounded-lg border-2 border-ink px-4 py-2 text-sm font-medium disabled:opacity-50";

  return (
    <div className="flex flex-col gap-2">
      {mode === "decide" ? (
        <div className="flex flex-wrap gap-2">
          {offerLabel && (
            <button onClick={() => run("accept")} disabled={busy !== null} className={recommended === "accept" ? primary : secondary}>
              {busy === "accept" ? "Refunding…" : `Accept ${offerLabel}`}
            </button>
          )}
          <button onClick={() => run("escalate")} disabled={busy !== null} className={recommended === "escalate" ? primary : secondary}>
            {busy === "escalate" ? "Opening a PayPal case…" : "Escalate to PayPal"}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => run("refresh")} disabled={busy !== null} className={secondary}>
            {busy === "refresh" ? "Checking…" : "Check PayPal status"}
          </button>
          {canPlayStore && (
            <button onClick={() => run("demo")} disabled={busy !== null} className="rounded-lg px-3 py-2 text-sm text-muted underline underline-offset-2 disabled:opacity-50">
              {busy === "demo" ? "The store's agent is answering…" : "Let the store's agent answer now"}
            </button>
          )}
        </div>
      )}
      {error && <p className="text-sm text-block">{error}</p>}
    </div>
  );
}
