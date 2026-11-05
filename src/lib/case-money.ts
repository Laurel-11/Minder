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
