"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function DecisionButtons({ purchaseId, total }: { purchaseId: string; total: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"approve" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "approve" | "decline") {
    setBusy(decision);
    setError(null);
    try {
      const res = await fetch(`/api/purchases/${purchaseId}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "PayPal did not accept the decision.");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => decide("decline")}
          disabled={busy !== null}
          className="rounded-lg border-2 border-ink px-4 py-3 font-medium disabled:opacity-50"
        >
          {busy === "decline" ? "Releasing…" : "Decline"}
        </button>
        <button
          onClick={() => decide("approve")}
          disabled={busy !== null}
          className="rounded-lg bg-approve px-4 py-3 font-medium text-paper disabled:opacity-50"
        >
          {busy === "approve" ? "Paying…" : `Pay ${total}`}
        </button>
      </div>
      <p className="text-xs text-muted">
        The money is already held in your PayPal. Pay sends it to the store. Decline releases it back to you.
      </p>
      {error && <p className="text-sm text-block">{error}</p>}
    </div>
  );
}
