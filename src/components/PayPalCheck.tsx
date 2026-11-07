"use client";

// Ask PayPal itself about a purchase and show where its records agree with Minder's, including the receipt
// fingerprint Minder wrote on the order.
import { useState } from "react";
import type { Verification } from "@/lib/studio-tools";

export function PayPalCheck({ purchaseId }: { purchaseId: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Verification | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/studio/verify?purchaseId=${encodeURIComponent(purchaseId)}`);
      const json = (await res.json()) as Verification & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "PayPal did not answer. Try again.");
      setResult(json);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div>
        <button type="button" onClick={run} disabled={busy} className="rounded-md border border-ink bg-white px-3 py-1.5 font-semibold hover:bg-[#f4f6f8] disabled:opacity-50">
          {busy ? "Asking PayPal…" : result ? "Ask PayPal again" : "Check with PayPal"}
        </button>
      </div>
      {error && <p className="text-block">{error}</p>}
      {result && (
        <div aria-live="polite">
          {result.checks.length > 0 && (
            <table className="w-full border-collapse text-left text-[13px]">
              <thead>
                <tr className="text-muted">
                  <th className="pb-1 font-normal">Check</th>
                  <th className="pb-1 font-normal">Minder</th>
                  <th className="pb-1 font-normal">PayPal</th>
                </tr>
              </thead>
              <tbody>
                {result.checks.map((c) => (
                  <tr key={c.label} className="border-t border-line align-top">
                    <td className="py-1 pr-2">{c.label}</td>
                    <td className="py-1 pr-2 break-all">{c.minder}</td>
                    <td className={`py-1 break-all ${c.match ? "text-approve" : "font-semibold text-block"}`}>
                      {c.match ? "✓ " : "✗ "}
                      {c.paypal}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className={`mt-2 ${result.allMatch ? "text-approve" : "text-block"}`}>{result.summary}</p>
        </div>
      )}
    </div>
  );
}
