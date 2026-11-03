// Chaperone's AI work after a purchase goes wrong: write the claim, and judge the store's offer.
import { generateJson, type Schema } from "./ai";
import { shortDateTime } from "./format";
import { usd } from "./money";
import type { CaseProblem, Offer, Purchase, RecoveryCase } from "./types";

const claimSchema: Schema = {
  type: "OBJECT",
  properties: {
    claim: { type: "STRING", description: "The message to the store's support agent. Polite, firm, factual, under 90 words." },
    askFor: {
      type: "OBJECT",
      properties: { kind: { type: "STRING", enum: ["full_refund", "partial_refund"] }, amount: { type: "NUMBER" } },
      required: ["kind", "amount"],
    },
  },
  required: ["claim", "askFor"],
};

export async function writeClaim(input: {
  purchase: Purchase;
  problem: CaseProblem;
  ownerNote?: string;
  timeline: { at: string; event: string }[];
}): Promise<{ claim: string; askFor: Offer; model?: string }> {
  const p = input.purchase;
  const fallback = {
    claim:
      input.problem === "not_delivered"
        ? `Order for ${p.request.items.map((i) => i.name).join(", ")} (${usd(p.total)}) was paid but never shipped, past your promised date. Please refund the full amount.`
        : `Order for ${p.request.items.map((i) => i.name).join(", ")} (${usd(p.total)}) arrived damaged: ${input.ownerNote ?? "see owner report"}. Please make this right.`,
    askFor: { kind: "full_refund" as const, amount: p.total },
  };
  try {
    const { data, model } = await generateJson<{ claim: string; askFor: Offer }>({
      system: `You write purchase-problem claims on behalf of a shopper, addressed to the store's customer-service agent.
Use only the facts given. Ask for a full refund when the item never arrived. When it arrived damaged, ask for a full refund unless the owner says the item still mostly works, in which case a fair partial refund is fine.`,
      prompt: `Store: ${p.request.merchant.name}
Order: ${p.request.items.map((i) => `${i.quantity} x ${i.name} ${usd(i.unitPrice)}`).join("; ")}. Total ${usd(p.total)}.
Problem: ${input.problem === "not_delivered" ? "never delivered" : "arrived damaged"}
Owner's note: ${input.ownerNote ?? "(none)"}
Timeline:
${input.timeline.map((t) => `- ${shortDateTime(t.at)}: ${t.event}`).join("\n")}`,
      schema: claimSchema,
    });
    const amount = Math.min(p.total, Math.max(0.01, Number(data.askFor?.amount) || p.total));
    return { claim: data.claim, askFor: { kind: data.askFor?.kind === "partial_refund" ? "partial_refund" : "full_refund", amount }, model };
  } catch {
    return fallback;
  }
}

const verdictSchema: Schema = {
  type: "OBJECT",
  properties: {
    action: { type: "STRING", enum: ["accept", "escalate"] },
    reasoning: { type: "STRING", description: "Two short sentences to the owner, as 'you'. Say what you recommend and why." },
  },
  required: ["action", "reasoning"],
};

export async function judgeOffer(input: { purchase: Purchase; recoveryCase: RecoveryCase; offer: Offer; merchantText: string }) {
  const { purchase: p, recoveryCase: c, offer } = input;
  if (offer.kind === "none") {
    return {
      action: "escalate" as const,
      reasoning: `${p.request.merchant.name} refused to refund and gave no tracking. Escalate to PayPal: an order that never arrived is exactly what Buyer Protection covers.`,
    };
  }
  if (offer.kind === "full_refund") {
    return { action: "accept" as const, reasoning: `${p.request.merchant.name} offered your full ${usd(p.total)} back. Accept it.` };
  }
  try {
    const { data, model } = await generateJson<{ action: "accept" | "escalate"; reasoning: string }>({
      system: `You advise a shopper whether to accept a store's settlement offer or escalate to a PayPal dispute.
Escalating takes days and may require returning the item. Accept a partial refund when it is fair for the actual harm (for example cosmetic damage on an item that still works). Escalate when the offer is unfair for the harm, or the item is unusable.`,
      prompt: `Order: ${p.request.items.map((i) => i.name).join(", ")}, total ${usd(p.total)}.
Problem: ${c.problem}. Owner's note: ${c.ownerNote ?? "(none)"}.
Store's reply: "${input.merchantText}"
Offer: ${offer.kind} ${usd(offer.amount)}.`,
      schema: verdictSchema,
      temperature: 0.1,
    });
    return { ...data, model };
  } catch {
    const fair = offer.amount >= p.total * 0.5;
    return {
      action: fair ? ("accept" as const) : ("escalate" as const),
      reasoning: `The AI advisor is unavailable. ${fair ? "The offer is at least half your money back, so accepting is reasonable." : "The offer is under half of what you paid, so escalating is reasonable."}`,
    };
  }
}
