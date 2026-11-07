import Link from "next/link";
import { notFound } from "next/navigation";
import { CaseView } from "@/components/CaseView";
import { DecisionButtons } from "@/components/DecisionButtons";
import { LiveRefresh } from "@/components/LiveRefresh";
import { PayPalCheck } from "@/components/PayPalCheck";
import { PurchaseSlip } from "@/components/PurchaseSlip";
import { ReportProblem } from "@/components/ReportProblem";
import { demoNow } from "@/lib/clock";
import { readDb } from "@/lib/db";
import { deliveryNow, isLate } from "@/lib/delivery";
import { shortDateTime, withinLast } from "@/lib/format";
import { usd } from "@/lib/money";
import { rangeWords } from "@/lib/market";
import { checkEvidence, checkReceipt, KIND_LABEL, publicKey } from "@/lib/receipts";
import { findBlockedMerchant } from "@/lib/rules";

export const dynamic = "force-dynamic";

const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export default async function PurchasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await readDb();
  const p = db.purchases.find((x) => x.id === id);
  if (!p) notFound();
  const now = demoNow(db);
  const delivery = p.delivery ? deliveryNow(p.delivery, now) : undefined;
  const openCase = db.cases.find((c) => c.purchaseId === p.id);
  const paid = p.status === "paid" || p.status === "approved_by_owner";
  // Oldest first: what PayPal itself reported about this purchase, through its webhooks.
  const fromPayPal = (db.paypalEvents ?? []).filter((e) => e.purchaseId === p.id).reverse();
  // Expect news from PayPal for a few minutes after money moves, and while PayPal handles a dispute.
  const recentMoney = Boolean(p.paypal.orderId) && withinLast(p.owner?.at ?? p.createdAt, 5 * 60_000);
  const waitingForPayPal = Boolean(recentMoney || openCase?.status === "escalated");
  const receipts = (db.receipts ?? []).filter((r) => r.purchaseId === p.id);
  const decided = receipts.find((r) => r.kind === "decision");
  const evidence = checkEvidence(p, decided);
  const keys = [publicKey()];
  const allSigned = receipts.every((r) => {
    const c = checkReceipt(r, keys);
    return c.contents && c.signature;
  });

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      {waitingForPayPal && <LiveRefresh />}
      <div>
        <h1 className="font-display text-2xl font-medium tracking-tight">{p.status === "awaiting_owner" ? "Your agent wants to pay" : "Purchase details"}</h1>
        {p.status === "awaiting_owner" && <p className="mt-1 text-muted">Nothing is charged until you decide.</p>}
      </div>
      <PurchaseSlip purchase={p} detailed />

      {p.status === "awaiting_owner" && <DecisionButtons purchaseId={p.id} total={usd(p.total)} />}

      {paid && delivery && (
        <section className="rounded-lg border border-line bg-paper p-4 text-sm">
          <p className="font-semibold">Delivery</p>
          {delivery.state === "awaiting_shipment" ? (
            <p className={`mt-1 ${isLate(delivery, now) ? "text-block" : "text-muted"}`}>
              Not shipped yet. {p.request.merchant.name} promised to ship by {fmt(delivery.promisedBy)}
              {isLate(delivery, now) ? ", and that date has passed." : "."}
            </p>
          ) : (
            <p className="mt-1 text-muted">
              {delivery.state === "delivered" ? "Delivered" : "On the way"} with {delivery.carrier}, tracking {delivery.trackingNumber}.
              {delivery.trackedInPayPal && " The tracking number is registered on the PayPal order, so PayPal can see it too."}
            </p>
          )}
        </section>
      )}

      {fromPayPal.length > 0 && (
        <section className="rounded-lg border border-line bg-paper p-4 text-sm">
          <p className="font-semibold">From PayPal</p>
          <p className="mt-1 text-muted">PayPal sent these notifications itself. Minder checked each signature with PayPal before believing it.</p>
          <ul className="mt-3 space-y-2">
            {fromPayPal.map((e) => (
              <li key={e.id} className="flex gap-3">
                <span className="shrink-0 tabular-nums text-muted">{shortDateTime(e.receivedAt)}</span>
                <span>
                  {e.summary} <span className="text-muted">({e.type})</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {openCase ? (
        <CaseView
          c={openCase}
          storeName={p.request.merchant.name}
          canBlockStore={Boolean(db.policy)}
          storeBlocked={Boolean(db.policy && findBlockedMerchant(db.policy, p.request.merchant.name))}
        />
      ) : (
        paid && delivery && <ReportProblem purchaseId={p.id} delivered={delivery.state === "delivered"} />
      )}

      {p.market && p.market.items.length > 0 && (
        <section className="rounded-lg border border-line bg-paper p-4 text-sm">
          <p className="font-semibold">What other stores charge</p>
          <p className="mt-1 text-muted">Before deciding, Minder looked each item up in Channel3&apos;s catalog of real retailers.</p>
          <ul className="mt-3 space-y-2">
            {p.market.items.map((m) => (
              <li key={m.item}>
                <span className="font-medium">{m.item}</span>: {usd(m.unitPrice)} here.{" "}
                {m.lowest === null ? (
                  <span className="text-muted">No comparable products found.</span>
                ) : (
                  <>
                    {rangeWords(m)} (cheapest at{" "}
                    <a href={m.lowest.url} className="underline underline-offset-2" rel="noopener noreferrer nofollow" target="_blank">
                      {m.lowest.store}
                    </a>
                    ).
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {receipts.length > 0 && (
        <section className="flex flex-col gap-3 rounded-lg border border-line bg-paper p-4 text-sm">
          <div>
            <p className="font-semibold">Receipts</p>
            <p className="mt-1 text-muted">
              {allSigned ? "Signed by Minder and chained in the " : "Some of these do not check out. See the "}
              <Link href="/receipts" className="underline underline-offset-2">
                receipt book
              </Link>
              .
              {evidence.checked &&
                (evidence.matches
                  ? " The store's page text, the agent's reason and the AI's findings kept with this purchase are exactly what Minder fingerprinted when it decided."
                  : " Some of the evidence kept with this purchase no longer matches what Minder fingerprinted when it decided.")}
            </p>
          </div>
          <ul className="flex flex-col gap-2">
            {receipts.map((r) => (
              <li key={r.n} className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-2">
                <span className="font-semibold tabular-nums">#{r.n}</span>
                <span>
                  <span className="text-muted">{KIND_LABEL[r.kind]}: </span>
                  {r.says} <span className="font-mono text-[11.5px] text-muted">{r.hash.slice(0, 10)}…</span>
                </span>
              </li>
            ))}
          </ul>
          {p.paypal.receiptOnOrder && decided && (
            <p className="text-muted">
              PayPal&apos;s order {p.paypal.orderId} carries the fingerprint of receipt #{decided.n} as its custom_id, so PayPal&apos;s own record points back here.
            </p>
          )}
          <div className="flex flex-wrap items-start gap-x-5 gap-y-3">
            {p.paypal.orderId && p.source !== "trick" && <PayPalCheck purchaseId={p.id} />}
            {p.source !== "trick" && (
              <a href={`/api/receipts/download?purchase=${p.id}`} className="py-1.5 font-medium underline underline-offset-2">
                Download the evidence
              </a>
            )}
          </div>
        </section>
      )}

      <details className="text-sm text-muted">
        <summary className="cursor-pointer">Every check Minder ran before paying</summary>
        <ul className="mt-2 space-y-1">
          {p.rules.checks.map((c, n) => (
            <li key={n}>
              <span className={c.outcome === "approve" ? "text-approve" : c.outcome === "hold" ? "text-hold" : "text-block"}>
                {c.outcome === "approve" ? "Pass" : c.outcome === "hold" ? "Ask" : "Stop"}
              </span>{" "}
              {c.rule}: {c.message}
            </li>
          ))}
          {p.ai && (
            <li>
              <span className={p.ai.verdict === "approve" ? "text-approve" : p.ai.verdict === "hold" ? "text-hold" : "text-block"}>
                {p.ai.verdict === "approve" ? "Pass" : p.ai.verdict === "hold" ? "Ask" : "Stop"}
              </span>{" "}
              AI review ({p.ai.model}): {p.ai.instructionMatch}
              {p.ai.manipulationSuspected && p.ai.manipulationEvidence && <> Suspicious page text: “{p.ai.manipulationEvidence}”</>}
            </li>
          )}
          {p.aiError && <li className="text-hold">AI review unavailable: {p.aiError}</li>}
        </ul>
      </details>

      <Link href="/" className="text-sm underline underline-offset-2">
        Back to activity
      </Link>
    </div>
  );
}
