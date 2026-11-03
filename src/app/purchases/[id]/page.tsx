import Link from "next/link";
import { notFound } from "next/navigation";
import { CaseView } from "@/components/CaseView";
import { DecisionButtons } from "@/components/DecisionButtons";
import { PurchaseSlip } from "@/components/PurchaseSlip";
import { ReportProblem } from "@/components/ReportProblem";
import { demoNow } from "@/lib/clock";
import { readDb } from "@/lib/db";
import { deliveryNow, isLate } from "@/lib/delivery";
import { usd } from "@/lib/money";
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

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{p.status === "awaiting_owner" ? "Your agent wants to pay" : "Purchase details"}</h1>
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

      <details className="text-sm text-muted">
        <summary className="cursor-pointer">Every check Chaperone ran before paying</summary>
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
