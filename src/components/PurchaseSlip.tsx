import Link from "next/link";
import { amountInWords, timeAgo } from "@/lib/format";
import { usd } from "@/lib/money";
import type { Purchase, PurchaseStatus } from "@/lib/types";
import { VerdictStamp } from "./VerdictStamp";

/** The foot of the slip, where a cheque gets signed: by Chaperone, by the owner, or by nobody. */
function SignatureLine({ status, owner }: { status: PurchaseStatus; owner: string }) {
  const signed = (name: string, text: string) => (
    <p className="flex flex-wrap items-baseline gap-x-3">
      <span className="font-signature text-[2.6rem] leading-none">{name}</span>
      <span className="text-sm text-muted">{text}</span>
    </p>
  );
  switch (status) {
    case "paid":
      return signed("Chaperone", "Signed and paid with PayPal.");
    case "approved_by_owner":
      return signed(owner, "Signed by you and paid with PayPal.");
    case "awaiting_owner":
      return (
        <p className="flex flex-wrap items-baseline gap-x-3">
          <span aria-hidden className="font-signature text-[2.6rem] leading-none text-[#b8c1cd]">
            your signature
          </span>
          <span className="text-sm text-hold">PayPal is holding the money until you decide.</span>
        </p>
      );
    case "blocked":
      return <p className="text-sm text-muted">Chaperone refused to sign. No money moved.</p>;
    case "declined_by_owner":
      return <p className="text-sm text-muted">You declined. PayPal released the hold.</p>;
    default:
      return <p className="text-sm text-block">PayPal could not take the payment.</p>;
  }
}

const AMOUNT_LOOK: Partial<Record<PurchaseStatus, string>> = {
  blocked: "border-block text-block line-through decoration-2",
  payment_failed: "border-block text-block line-through decoration-2",
  declined_by_owner: "border-line text-muted line-through decoration-2",
};

/**
 * A purchase drawn as a cheque slip: security band, "Pay to", memo, the amount in a box,
 * the verdict stamp, and a signature line at the torn foot.
 */
export function PurchaseSlip({
  purchase: p,
  note,
  link = false,
  detailed = false,
  owner = "Maya",
}: {
  purchase: Purchase;
  note?: { text: string; tone: string };
  link?: boolean;
  /** Purchase page: also write the amount out in words. */
  detailed?: boolean;
  owner?: string;
}) {
  const r = p.request;
  return (
    <article className="slip shadow-[0_1px_0_var(--color-line)]">
      <div aria-hidden className="guilloche h-3" />
      <div className="px-5 pt-4">
        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs text-muted">Pay to</p>
            <h3 className="text-lg font-semibold leading-tight">{r.merchant.name}</h3>
            <p className="mt-0.5 text-sm text-muted">
              Written by {r.agent}, {timeAgo(p.createdAt)}
            </p>
          </div>
          <VerdictStamp status={p.status} />
        </header>

        <dl className="mt-4 grid grid-cols-[3.25rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
          <dt className="text-muted">Memo</dt>
          <dd>You asked: “{r.ownerInstruction}”</dd>
          <dt className="text-muted">Items</dt>
          <dd>
            <ul className="space-y-1">
              {r.items.map((i, n) => (
                <li key={n} className="flex justify-between gap-4">
                  <span>
                    {i.quantity > 1 ? `${i.quantity} × ` : ""}
                    {i.name}
                  </span>
                  <span className="tabular-nums text-muted">{usd(i.unitPrice * i.quantity)}</span>
                </li>
              ))}
            </ul>
          </dd>
        </dl>

        <div className="mt-3 flex items-center justify-between gap-4 border-t border-dashed border-line pt-3">
          <span className={`text-sm ${detailed ? "italic" : "text-muted"}`}>{detailed ? amountInWords(p.total) : "Amount"}</span>
          <span className={`rounded border-[1.5px] px-2.5 py-0.5 text-lg font-semibold tabular-nums ${AMOUNT_LOOK[p.status] ?? "border-ink"}`}>
            {usd(p.total)}
          </span>
        </div>

        <div className="mt-4 text-sm">
          <p className="font-medium">Why</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-muted">
            {p.reasons.slice(0, 3).map((reason, n) => (
              <li key={n}>{reason}</li>
            ))}
          </ul>
        </div>

        {note && <p className={`mt-4 text-sm font-medium ${note.tone}`}>{note.text}</p>}
        {p.paypal.error && <p className="mt-3 text-sm text-block">PayPal: {p.paypal.error}</p>}

        <footer className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
          <SignatureLine status={p.status} owner={owner} />
          {link && (
            <Link
              href={`/purchases/${p.id}`}
              className={`inline-flex rounded-lg px-4 py-2 text-sm font-medium ${p.status === "awaiting_owner" ? "bg-ink text-paper hover:opacity-90" : "border border-line hover:border-ink"}`}
            >
              {p.status === "awaiting_owner" ? "Review and sign" : "Details"}
            </Link>
          )}
        </footer>
      </div>
    </article>
  );
}
