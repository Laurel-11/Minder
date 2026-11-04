"use client";

// How Minder's own agent tools look in AG Studio's chat panel: a purchase slip, a side-by-side
// check against PayPal's records, a what-if table, and a cheque the owner signs. Money only moves
// when the owner presses the button on the cheque; the agents can only prepare it.
import type { AgAiToolDetailParams } from "ag-studio";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PurchaseRecord, Verification, WhatIf } from "@/lib/studio-tools";
import { amountInWords } from "@/lib/format";

const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
const tone = (status: string) =>
  /block|fail/i.test(status) ? "text-block" : /wait|asked/i.test(status) ? "text-hold" : /declin/i.test(status) ? "text-muted" : "text-approve";
const dataOf = <T,>(p: AgAiToolDetailParams): T | undefined => (p.result && p.result.success ? (p.result.data as T | undefined) : undefined);
const Failed = ({ p }: { p: AgAiToolDetailParams }) =>
  p.result && !p.result.success ? <p className="text-[13px] text-block">{p.result.issues.map((i) => i.message).join(" ")}</p> : null;

export function PurchaseFoundCard(p: AgAiToolDetailParams) {
  const d = dataOf<{ matches: PurchaseRecord[] }>(p);
  if (!d) return <Failed p={p} />;
  return (
    <div className="flex flex-col gap-2 text-[13px] text-ink">
      {d.matches.map((m) => (
        <div key={m.purchaseId} className="rounded-md border border-line bg-white px-3 py-2.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-semibold">{m.store}</div>
              <div className="text-muted">{usd(m.total)}, {m.items.map((i) => i.name).join(", ")}</div>
            </div>
            <span className={`stamp shrink-0 text-[11px] ${tone(m.status)}`}>{m.status}</span>
          </div>
          <p className="mt-1.5">You asked: &ldquo;{m.ownerAsked}&rdquo;</p>
          {m.reasons[0] && <p className="mt-1 text-muted">{m.reasons[0]}</p>}
          {m.ai?.storeSaid && <p className="mt-1.5 border-l-2 border-block pl-2 text-[12.5px] italic">&ldquo;{m.ai.storeSaid.replace(/^["“”']+|["“”']+$/g, "")}&rdquo;</p>}
        </div>
      ))}
    </div>
  );
}

export function PayPalCheckCard(p: AgAiToolDetailParams) {
  const v = dataOf<Verification>(p);
  if (!v) return <Failed p={p} />;
  return (
    <div className="rounded-md border border-line bg-white px-3 py-2.5 text-[13px] text-ink">
      <p className="font-semibold">{v.store}</p>
      {v.orderId && <p className="text-[12px] text-muted">PayPal order {v.orderId}</p>}
      {v.checks.length > 0 && (
        <table className="mt-2 w-full border-collapse text-left text-[12.5px]">
          <thead>
            <tr className="text-muted">
              <th className="pb-1 font-normal">Check</th>
              <th className="pb-1 font-normal">Minder</th>
              <th className="pb-1 font-normal">PayPal</th>
            </tr>
          </thead>
          <tbody>
            {v.checks.map((c) => (
              <tr key={c.label} className="border-t border-[#eceff3] align-top">
                <td className="py-1 pr-2">{c.label}</td>
                <td className="py-1 pr-2">{c.minder}</td>
                <td className={`py-1 ${c.match ? "text-approve" : "font-semibold text-block"}`}>
                  {c.match ? "✓ " : "✗ "}
                  {c.paypal}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className={`mt-2 ${v.allMatch ? "text-approve" : "text-block"}`}>{v.summary}</p>
    </div>
  );
}

export function WhatIfCard(p: AgAiToolDetailParams) {
  const w = dataOf<WhatIf>(p);
  if (!w) return <Failed p={p} />;
  const changed = w.rows.filter((r) => r.changed);
  return (
    <div className="rounded-md border border-line bg-white px-3 py-2.5 text-[13px] text-ink">
      <p className="text-muted">What if: {w.changes.join("; ")}</p>
      {changed.length === 0 ? (
        <p className="mt-2">Every past purchase would have gone the same way.</p>
      ) : (
        <ul className="mt-2 flex flex-col divide-y divide-[#eceff3]">
          {changed.map((r) => (
            <li key={r.purchaseId} className="py-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold">{r.store}</span>
                <span className="tabular-nums text-muted">{usd(r.total)}</span>
              </div>
              <div>
                <span className="text-muted line-through">{r.before}</span> <span className={`font-semibold ${tone(r.after)}`}>{r.after}</span>
              </div>
              <div className="text-[12px] text-muted">{r.why}</div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[12px] text-muted">Nothing has changed. To change a rule for real, use the Rules page.</p>
    </div>
  );
}

/** A held purchase drawn as a cheque, with the owner's two buttons. Only the owner's click moves the money. */
export function Cheque({ purchase: m, compact = false }: { purchase: PurchaseRecord; compact?: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "working" | "approved" | "declined" | "error">("idle");
  const [error, setError] = useState("");
  const decide = async (decision: "approve" | "decline") => {
    setState("working");
    const r = await fetch(`/api/purchases/${m.purchaseId}/decision`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }) });
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    if (!r.ok) {
      setError(j.error ?? "PayPal did not answer. Try again.");
      setState("error");
      return;
    }
    setState(decision === "approve" ? "approved" : "declined");
    router.refresh();
  };
  return (
    <div className={`overflow-hidden rounded-md border border-line bg-[#fbfcf8] text-ink ${compact ? "text-[13px]" : "text-[14px]"}`}>
      <div aria-hidden className="guilloche h-2" />
      <div className="flex flex-col gap-2 px-3 py-2.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[12px] text-muted">Pay to</div>
            <div className={`font-semibold ${compact ? "text-[15px]" : "text-[18px]"}`}>{m.store}</div>
          </div>
          <div className={`rounded border border-ink bg-white px-2 py-0.5 font-semibold tabular-nums ${compact ? "text-[15px]" : "text-[18px]"}`}>{usd(m.total)}</div>
        </div>
        <div className="border-b border-line pb-1 italic">{amountInWords(m.total)}</div>
        <div>
          <span className="text-muted">Memo </span>You asked: &ldquo;{m.ownerAsked}&rdquo;
        </div>
        {m.reasons[0] && (
          <div>
            <span className="text-muted">Why you </span>
            {m.reasons[0]}
          </div>
        )}
      </div>
      <div className="border-t border-dashed border-line bg-[#f8f3e8] px-3 py-2.5">
        {state === "approved" ? (
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-signature text-[2rem] leading-none">Maya</span>
            <span className="text-approve">Signed. PayPal sent {usd(m.total)} to {m.store}.</span>
          </p>
        ) : state === "declined" ? (
          <p className="text-muted">Declined. PayPal released the hold; nothing was paid.</p>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={state === "working"}
                onClick={() => decide("approve")}
                className="rounded-md bg-ink px-3 py-1.5 font-semibold text-paper hover:opacity-90 disabled:opacity-50"
              >
                Sign and pay {usd(m.total)}
              </button>
              <button
                type="button"
                disabled={state === "working"}
                onClick={() => decide("decline")}
                className="rounded-md border border-ink bg-white px-3 py-1.5 font-semibold hover:bg-[#f4f6f8] disabled:opacity-50"
              >
                Decline
              </button>
            </div>
            <p className="text-[12px] text-muted">PayPal is holding the money. Only your click sends it.</p>
            {state === "error" && <p className="text-[12px] text-block">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

/** The chat card for prepare_approval: the same cheque, kept in the conversation as a record. */
export function ApprovalCheque(p: AgAiToolDetailParams) {
  const m = dataOf<PurchaseRecord>(p);
  if (!m) return <Failed p={p} />;
  return <Cheque purchase={m} compact />;
}
