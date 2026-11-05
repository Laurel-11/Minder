// How much of a purchase came back to the owner through a recovery case. No server code, so pages and the dashboard share it.
import type { RecoveryCase } from "./types";

/** PayPal outcomes that send the money back to the buyer. */
const WON = ["RESOLVED_BUYER_FAVOUR", "ACCEPTED", "RESOLVED_WITH_PAYOUT"];

export const disputeWon = (c?: RecoveryCase) => Boolean(c?.dispute?.outcome && WON.includes(c.dispute.outcome));

/** A refund the owner accepted, or a dispute PayPal settled in the owner's favour. */
export function moneyBack(c?: RecoveryCase): number {
  if (c?.status === "refunded") return c.refund?.amount ?? 0;
  if (disputeWon(c)) return c?.dispute?.amount ?? 0;
  return 0;
}

const DISPUTE_WORDS: Record<string, string> = {
  OPEN: "PayPal opened the case.",
  WAITING_FOR_SELLER_RESPONSE: "PayPal is waiting for the store to respond.",
  WAITING_FOR_BUYER_RESPONSE: "PayPal is waiting for your response.",
  UNDER_REVIEW: "PayPal is reviewing the case.",
  RESOLVED: "PayPal resolved the case.",
  OTHER: "PayPal is handling the case.",
};
export const disputeInWords = (status: string) => DISPUTE_WORDS[status] ?? DISPUTE_WORDS.OTHER;

const OUTCOME: Record<string, (amount: string) => string> = {
  RESOLVED_BUYER_FAVOUR: (a) => `PayPal decided in your favour${a ? `: ${a} goes back to you` : ""}.`,
  RESOLVED_SELLER_FAVOUR: () => "PayPal decided in the store's favour.",
  RESOLVED_WITH_PAYOUT: (a) => `PayPal paid you${a ? ` ${a}` : ""} to settle the case.`,
  ACCEPTED: (a) => `The store accepted your claim${a ? `: ${a} goes back to you` : ""}.`,
  CANCELED_BY_BUYER: () => "The case was withdrawn.",
};
/** PayPal's final decision on a dispute, in the owner's words. `amount` is already formatted, e.g. "$9.00". */
export const outcomeInWords = (code?: string, amount = "") => (code && OUTCOME[code] ? OUTCOME[code](amount) : "PayPal closed the case.");
