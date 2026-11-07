import Link from "next/link";
import { disputeWon, moneyBack } from "@/lib/case-money";
import { ConnectPayPalButton } from "@/components/ConnectPayPalButton";
import { DemoClock } from "@/components/DemoClock";
import { HeroSlips, type DeskSlip } from "@/components/HeroSlips";
import { MoneySplit, SPLIT_COLORS } from "@/components/MoneySplit";
import { PurchaseSlip } from "@/components/PurchaseSlip";
import { demoNow } from "@/lib/clock";
import { withAndWithout } from "@/lib/dashboard-data";
import { readSharedDb } from "@/lib/db";
import { deliveryNow, isLate } from "@/lib/delivery";
import { usd } from "@/lib/money";
import { checkBook } from "@/lib/receipts";
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
  const db = await readSharedDb();
  const connect = (await searchParams).connect;
  const banner = typeof connect === "string" ? banners[connect] : undefined;
  const waitingList = db.purchases.filter((p) => p.status === "awaiting_owner");
  const waiting = waitingList.length;
  const weekAgo = demoNow(db).getTime() - 7 * 86_400_000;
  const thisWeek = db.purchases.filter((p) => new Date(p.createdAt).getTime() >= weekAgo);
  const sum = (list: Purchase[]) => list.reduce((s, p) => s + p.total, 0);
  const spent = sum(thisWeek.filter((p) => p.status === "paid" || p.status === "approved_by_owner"));
  const keptSafe = sum(thisWeek.filter((p) => p.status === "blocked" || p.status === "declined_by_owner"));
  const setupDone = Boolean(db.vault && db.policy);
  const ww = withAndWithout(db.purchases, db.cases);
  const deskSlips = slipsForDesk(db);
  const book = checkBook(db.receipts ?? []);

  return (
    <div className="page-wide relative left-1/2 flex w-[min(1120px,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-12 lg:gap-16">
      {banner && <p className={`rounded-lg px-4 py-3 text-sm ${banner.tone}`}>{banner.text}</p>}

      <section className="overflow-x-clip lg:overflow-visible">
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-14">
          <div>
            <h1 className="font-display text-[2.35rem] font-medium leading-[1.08] tracking-tight sm:text-5xl lg:text-[3.35rem]">
              Buyer protection for the purchases your AI agent makes.
            </h1>
            <p className="mt-5 max-w-[34rem] text-base leading-relaxed text-muted sm:text-[17px]">
              PayPal protects you when an order never arrives or is not as described. But when a store page talks your agent into buying something you never asked
              for, the order arrives exactly as described, so that protection may not help. Minder checks every purchase before the money moves, and files the
              claims PayPal does cover when an order goes wrong.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/agent#trick" className="rounded-lg bg-ink px-5 py-3 text-[15px] font-medium text-paper hover:bg-[#2a3448]">
                Try to trick it
              </Link>
              <Link href="/how-it-works" className="rounded-lg border-2 border-ink px-5 py-2.5 text-[15px] font-medium hover:bg-paper">
                How it works
              </Link>
            </div>
          </div>
          {deskSlips.length > 0 && <HeroSlips slips={deskSlips} />}
        </div>
      </section>

      {db.purchases.length > 0 && (
        <section className="grid items-start gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-12">
          <div className="flex flex-col gap-5">
          <h2 className="font-display text-2xl font-medium tracking-tight">Maya&apos;s week</h2>
          <p className="max-w-prose text-[15px] leading-relaxed">
            Without Minder, ShopBot would have paid <strong className="tabular-nums">{usd(ww.withoutMinder)}</strong> of Maya&apos;s money
            {ww.tricked > 0 && (
              <>
                , including <strong className="tabular-nums">{usd(ww.tricked)}</strong> on {ww.trickedOrders === 1 ? "an order" : `${ww.trickedOrders} orders`} a store page tricked it into
              </>
            )}
            . With Minder, <strong className="tabular-nums">{usd(ww.withMinder)}</strong> went out
            {ww.trickedPaid === 0 && ww.tricked > 0 ? ", none of it to a trick" : ""}
            {ww.recovered > 0 && (
              <>
                , and <strong className="tabular-nums">{usd(ww.recovered)}</strong> came back through PayPal after an order went wrong
              </>
            )}
            .
          </p>
          <dl className="grid grid-cols-3 divide-x divide-line rounded-md border border-line bg-paper">
            <div className="px-3 py-2.5 sm:px-4">
              <dt className="text-xs text-muted">Spent this week</dt>
              <dd className="text-lg font-semibold tabular-nums sm:text-xl">{usd(spent)}</dd>
            </div>
            <div className="px-3 py-2.5 sm:px-4">
              <dt className="text-xs text-muted">Kept safe</dt>
              <dd className="text-lg font-semibold tabular-nums text-approve sm:text-xl">{usd(keptSafe)}</dd>
            </div>
            <div className="px-3 py-2.5 sm:px-4">
              <dt className="text-xs text-muted">Waiting for you</dt>
              <dd className={`text-lg font-semibold sm:text-xl ${waiting ? "text-hold" : ""}`}>
                {waiting ? (
                  <Link href={`/purchases/${waitingList[0].id}`} className="underline decoration-2 underline-offset-4">
                    {waiting === 1 ? "1 to sign" : `${waiting} to sign`}
                  </Link>
                ) : (
                  "Nothing"
                )}
              </dd>
            </div>
          </dl>
          </div>
          <div className="rounded-lg border border-line bg-paper p-4 sm:p-5 lg:mt-12">
            <MoneySplit
              title={`Where the ${usd(ww.withoutMinder)} ShopBot asked to spend went`}
              parts={[
                { label: "Stopped: store tricks", amount: ww.tricked - ww.trickedPaid, color: SPLIT_COLORS.trick },
                { label: "Stopped by Maya's rules or her no", amount: ww.withoutMinder - ww.withMinder - (ww.tricked - ww.trickedPaid), color: SPLIT_COLORS.stopped },
                { label: "Came back through PayPal", amount: ww.recovered, color: SPLIT_COLORS.back },
                { label: "Paid to stores", amount: ww.withMinder - ww.recovered, color: SPLIT_COLORS.paid },
              ]}
            />
          </div>
        </section>
      )}

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
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h2 className="font-display text-2xl font-medium tracking-tight">Activity</h2>
          {book.count > 0 && (
            <Link href="/receipts" className={`text-sm underline underline-offset-2 ${book.ok ? "" : "text-block"}`}>
              {book.ok ? `Every decision is signed: ${book.count} receipts, all check out` : "The receipt book does not check out"}
            </Link>
          )}
        </div>
        {db.purchases.length === 0 ? (
          <p className="text-muted">
            Nothing yet. When your agent asks to pay for something, it appears here with Minder&apos;s decision and the reason.
          </p>
        ) : (
          <div className="gap-6 lg:columns-2">
            {db.purchases.map((p) => (
              <div key={p.id} className="mb-6 break-inside-avoid">
                <PurchaseSlip purchase={p} note={noteFor(p, db)} link />
              </div>
            ))}
          </div>
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
    if (c.status === "closed")
      return disputeWon(c)
        ? { text: `Money back: PayPal closed case ${c.dispute?.disputeId} in your favour${moneyBack(c) ? ` (${usd(moneyBack(c))})` : ""}.`, tone: "text-approve" }
        : { text: "Case closed.", tone: "text-muted" };
    return { text: `${p.request.merchant.name} replied to Minder's claim. Your decision is needed.`, tone: "text-hold" };
  }
  if (!p.delivery) return undefined;
  const now = demoNow(db);
  const d = deliveryNow(p.delivery, now);
  if (isLate(d, now)) return { text: "Not shipped, past the promised date.", tone: "text-block" };
  if (d.state === "awaiting_shipment") return { text: "Waiting for the store to ship.", tone: "text-muted" };
  return { text: d.state === "delivered" ? "Delivered." : `On the way, tracked in PayPal (${d.carrier}).`, tone: "text-muted" };
}

const itemsOf = (p: Purchase) => p.request.items.map((i) => ({ name: i.name, quantity: i.quantity, price: i.unitPrice }));
const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n).trimEnd()}…` : t);

/** The hero's three slips, from real purchases: one refunded after it went wrong, one held for the owner, one trick blocked. */
function slipsForDesk(db: Db): DeskSlip[] {
  const slips: DeskSlip[] = [];
  const refundCase = db.cases.find((c) => c.status === "refunded" && c.refund);
  const refunded = refundCase && db.purchases.find((p) => p.id === refundCase.purchaseId);
  if (refunded && refundCase?.refund) {
    slips.push({
      id: refunded.id,
      store: refunded.request.merchant.name,
      items: itemsOf(refunded),
      total: refunded.total,
      stamp: { label: `${usd(refundCase.refund.amount)} back`, tone: "text-approve" },
      note: `It arrived ${refundCase.problem === "damaged" ? "damaged" : "late"}. The store refunded ${usd(refundCase.refund.amount)} through PayPal.`,
    });
  }
  const held = db.purchases.find((p) => p.status === "awaiting_owner") ?? db.purchases.find((p) => p.status === "approved_by_owner");
  if (held) {
    const waiting = held.status === "awaiting_owner";
    slips.push({
      id: held.id,
      store: held.request.merchant.name,
      items: itemsOf(held),
      total: held.total,
      stamp: waiting ? { label: "Held for you", tone: "text-hold" } : { label: "Approved by you", tone: "text-approve" },
      note: waiting ? "Over your $100 line, so PayPal is holding the money until you decide." : "Over your $100 line: PayPal held the money until you signed.",
      signature: waiting ? undefined : { name: "Maya", text: "Signed by you." },
    });
  }
  const trick = db.purchases.find((p) => p.status === "blocked" && p.ai?.manipulationSuspected && p.ai.manipulationEvidence);
  if (trick) {
    slips.push({
      id: trick.id,
      store: trick.request.merchant.name,
      items: itemsOf(trick),
      total: trick.total,
      stamp: { label: "Blocked", tone: "text-block" },
      struck: true,
      note: `The store's page told the agent: \u201c${clip(trick.ai!.manipulationEvidence.replace(/^["\u201c\u201d']+|["\u201c\u201d']+$/g, ""), 130)}\u201d`,
      noteTone: "text-ink",
      foot: "Minder refused to sign. No money moved.",
    });
  }
  return slips;
}
