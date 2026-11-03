import Link from "next/link";
import { ConnectPayPalButton } from "@/components/ConnectPayPalButton";
import { DemoClock } from "@/components/DemoClock";
import { PurchaseSlip } from "@/components/PurchaseSlip";
import { demoNow } from "@/lib/clock";
import { readDb } from "@/lib/db";
import { deliveryNow, isLate } from "@/lib/delivery";
import { usd } from "@/lib/money";
import { checkDeliveries } from "@/lib/recovery";
import type { Db, Purchase } from "@/lib/types";

export const dynamic = "force-dynamic";

const banners: Record<string, { tone: string; text: string }> = {
  ok: { tone: "bg-approve-soft text-approve", text: "PayPal connected. Approved purchases are now paid without another login." },
  failed: { tone: "bg-block-soft text-block", text: "PayPal sent you back, but saving the connection failed. Try again, or open Status to see what is wrong." },
  cancelled: { tone: "bg-hold-soft text-hold", text: "You cancelled in PayPal. Nothing was saved." },
  missing: { tone: "bg-hold-soft text-hold", text: "That PayPal link expired. Connect again." },
};

export default async function ActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await checkDeliveries();
  const db = await readDb();
  const connect = (await searchParams).connect;
  const banner = typeof connect === "string" ? banners[connect] : undefined;
  const waiting = db.purchases.filter((p) => p.status === "awaiting_owner").length;
  const setupDone = Boolean(db.vault && db.policy);

  return (
    <div className="flex flex-col gap-8">
      {banner && <p className={`rounded-lg px-4 py-3 text-sm ${banner.tone}`}>{banner.text}</p>}

      <section>
        <h1 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
          Every purchase your AI agent tries to make, checked before the money moves.
        </h1>
        {waiting > 0 && (
          <p className="mt-3 text-hold">
            {waiting === 1 ? "1 purchase is" : `${waiting} purchases are`} waiting for your decision.
          </p>
        )}
      </section>

      {!setupDone && (
        <section className="rounded-lg border border-line bg-paper p-5">
          <h2 className="font-semibold">Finish setting up</h2>
          <ol className="mt-3 space-y-4 text-sm">
            <li className="flex flex-col gap-2">
              <span className={db.vault ? "text-approve" : ""}>
                {db.vault ? "✓ PayPal connected" : "1. Connect PayPal once. Your agent never sees your login."}
              </span>
              {!db.vault && <ConnectPayPalButton />}
            </li>
            <li>
              {db.policy ? (
                <span className="text-approve">✓ Rules saved</span>
              ) : (
                <span>
                  2. <Link href="/rules" className="underline underline-offset-2">Write your spending rules</Link> in your own words.
                </span>
              )}
            </li>
          </ol>
        </section>
      )}

      <section className="flex flex-col gap-5">
        <h2 className="text-lg font-semibold">Activity</h2>
        {db.purchases.length === 0 ? (
          <p className="text-muted">
            Nothing yet. When your agent asks to pay for something, it appears here with Chaperone&apos;s decision and the reason.
          </p>
        ) : (
          db.purchases.map((p) => <PurchaseSlip key={p.id} purchase={p} note={noteFor(p, db)} link />)
        )}
      </section>

      <DemoClock days={db.demoClockDays ?? 0} />
    </div>
  );
}

/** One line under a paid purchase: where the parcel is, or how getting the money back is going. */
function noteFor(p: Purchase, db: Db): { text: string; tone: string } | undefined {
  const c = db.cases.find((x) => x.purchaseId === p.id);
  if (c) {
    if (c.status === "refunded") return { text: `Money back: ${usd(c.refund?.amount ?? 0)} refunded through PayPal.`, tone: "text-approve" };
    if (c.status === "escalated") return { text: `Escalated to PayPal (case ${c.dispute?.disputeId}).`, tone: "text-hold" };
    return { text: `${p.request.merchant.name} replied to Chaperone's claim. Your decision is needed.`, tone: "text-hold" };
  }
  if (!p.delivery) return undefined;
  const now = demoNow(db);
  const d = deliveryNow(p.delivery, now);
  if (isLate(d, now)) return { text: "Not shipped, past the promised date.", tone: "text-block" };
  if (d.state === "awaiting_shipment") return { text: "Waiting for the store to ship.", tone: "text-muted" };
  return { text: d.state === "delivered" ? "Delivered." : `On the way, tracked in PayPal (${d.carrier}).`, tone: "text-muted" };
}
