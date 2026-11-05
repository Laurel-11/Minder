import { shortDateTime } from "@/lib/format";
import { disputeInWords, disputeWon, outcomeInWords } from "@/lib/case-money";
import { usd } from "@/lib/money";
import type { Offer, RecoveryCase } from "@/lib/types";
import { BlockStore } from "./BlockStore";
import { CaseActions } from "./CaseActions";

const WHO: Record<string, string> = { minder: "Minder", merchant: "Store", paypal: "PayPal", owner: "You" };
const offerText = (o?: Offer) => (!o || o.kind === "none" ? "" : o.kind === "full_refund" ? `full refund (${usd(o.amount)})` : `${usd(o.amount)} back`);

export function CaseView({
  c,
  storeName,
  canBlockStore = false,
  storeBlocked = false,
}: {
  c: RecoveryCase;
  storeName: string;
  canBlockStore?: boolean;
  storeBlocked?: boolean;
}) {
  const lastOffer = c.messages.filter((m) => m.from === "merchant").at(-1)?.offer;
  const won = disputeWon(c);
  const headline =
    c.status === "refunded"
      ? `${usd(c.refund?.amount ?? 0)} is back in your PayPal.`
      : c.status === "closed" && c.dispute?.outcome
        ? won
          ? `${c.dispute.amount ? usd(c.dispute.amount) : "Your money"} is back in your PayPal: PayPal closed the case in your favour.`
          : outcomeInWords(c.dispute.outcome)
        : c.status === "escalated"
          ? `Escalated to PayPal: ${disputeInWords(c.dispute?.status ?? "OPEN")}`
          : c.status === "closed"
            ? "Case closed."
            : "Minder needs your decision.";

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-line bg-paper p-5">
      <div>
        <p className="text-sm text-muted">
          {c.openedBy === "minder" ? "Minder noticed this order never shipped and opened a case." : `You reported that it ${c.problem === "not_delivered" ? "never arrived" : "arrived damaged"}.`}
        </p>
        <h2 className={`mt-1 text-xl font-semibold ${c.status === "refunded" || won ? "text-approve" : ""}`}>{headline}</h2>
      </div>

      <ol className="flex flex-col gap-3">
        {c.messages.map((m, n) => (
          <li key={n} className={`rounded-lg px-4 py-3 text-sm ${m.from === "merchant" ? "bg-[#f4f2fb]" : m.from === "paypal" ? "bg-approve-soft" : "bg-canvas"}`}>
            <p className="font-medium">
              {m.from === "merchant" ? storeName : WHO[m.from]}
              {m.from === "minder" && n === 0 ? ` to ${storeName}` : ""}
            </p>
            <p className="mt-1 leading-relaxed">{m.text}</p>
          </li>
        ))}
      </ol>

      {c.status === "offer_to_review" && c.recommendation && (
        <div className="flex flex-col gap-3 border-t border-line pt-4">
          <p className="text-sm">
            <span className="font-medium">Minder recommends {c.recommendation.action === "accept" ? "accepting" : "escalating to PayPal"}. </span>
            {c.recommendation.reasoning}
          </p>
          <CaseActions caseId={c.id} mode="decide" offerLabel={offerText(lastOffer) || undefined} recommended={c.recommendation.action} />
        </div>
      )}

      {c.status === "escalated" && c.dispute && (
        <div className="flex flex-col gap-3 border-t border-line pt-4 text-sm">
          <p>
            PayPal case <span className="font-medium">{c.dispute.disputeId}</span>. {disputeInWords(c.dispute.status)}
            {c.dispute.status === "OPEN" && " New cases take a few minutes to reach the store."}
          </p>
          <CaseActions caseId={c.id} mode="escalated" canPlayStore={c.dispute.status === "WAITING_FOR_SELLER_RESPONSE"} />
        </div>
      )}

      {c.status !== "offer_to_review" && canBlockStore && <BlockStore caseId={c.id} storeName={storeName} problem={c.problem} blocked={storeBlocked} />}

      <details className="text-sm text-muted">
        <summary className="cursor-pointer">Evidence timeline Minder sent</summary>
        <ul className="mt-2 space-y-1">
          {c.timeline.map((t, n) => (
            <li key={n}>
              <span className="tabular-nums">{shortDateTime(t.at)}</span> {t.event}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
