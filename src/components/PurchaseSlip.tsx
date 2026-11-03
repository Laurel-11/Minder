import Link from "next/link";
import { timeAgo } from "@/lib/format";
import { usd } from "@/lib/money";
import type { Purchase } from "@/lib/types";
import { VerdictStamp } from "./VerdictStamp";

export function PurchaseSlip({ purchase: p, note, link = false }: { purchase: Purchase; note?: { text: string; tone: string }; link?: boolean }) {
  const r = p.request;
  return (
    <article className="slip px-5 pt-5 shadow-[0_1px_0_var(--color-line)]">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold leading-tight">{r.merchant.name}</h3>
          <p className="text-sm text-muted">
            {r.agent}, {timeAgo(p.createdAt)}
          </p>
        </div>
        <VerdictStamp status={p.status} />
      </header>

      <p className="mt-3 border-l-2 border-line pl-3 text-sm text-muted">
        You asked: <span className="text-ink">“{r.ownerInstruction}”</span>
      </p>

      <ul className="mt-4 space-y-1 text-sm">
        {r.items.map((i, n) => (
          <li key={n} className="flex justify-between gap-4">
            <span>
              {i.quantity > 1 ? `${i.quantity} × ` : ""}
              {i.name}
            </span>
            <span className="tabular-nums">{usd(i.unitPrice * i.quantity)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex justify-between border-t border-dashed border-line pt-2 font-semibold">
        <span>Total</span>
        <span className="tabular-nums">{usd(p.total)}</span>
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
      {link && (
        <Link
          href={`/purchases/${p.id}`}
          className={`mt-4 inline-flex rounded-lg px-4 py-2 text-sm font-medium ${p.status === "awaiting_owner" ? "bg-ink text-paper hover:opacity-90" : "border border-line hover:border-ink"}`}
        >
          {p.status === "awaiting_owner" ? "Review and decide" : "Details"}
        </Link>
      )}
      {p.paypal.error && <p className="mt-3 text-sm text-block">PayPal: {p.paypal.error}</p>}
    </article>
  );
}
