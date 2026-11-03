// Stand-ins for each demo store's customer-service agent. Scripted on purpose: the store side is a prop,
// and keeping it deterministic saves the AI quota for Chaperone's own reasoning.
import { findStoreByName } from "./catalog";
import { usd } from "./money";
import type { CaseProblem, Offer, Purchase } from "./types";

export function merchantReply(p: Purchase, problem: CaseProblem): { text: string; offer: Offer } {
  const store = findStoreByName(p.request.merchant.name);
  const total = p.total;
  if (store?.fulfillment === "never_ships") {
    return {
      text: "All sales are final. Your order is being processed. Please allow 30 to 45 business days and check your spam folder for tracking.",
      offer: { kind: "none", amount: 0 },
    };
  }
  if (store?.fulfillment === "ships_damaged" && problem === "damaged") {
    const half = Math.round(total * 50) / 100;
    return {
      text: `Sorry it arrived damaged. We can refund 50% (${usd(half)}) and you keep the item. A full refund needs the item shipped back at your own cost.`,
      offer: { kind: "partial_refund", amount: half },
    };
  }
  return { text: "We are sorry about this. We have approved a full refund.", offer: { kind: "full_refund", amount: total } };
}
