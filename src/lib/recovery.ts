// Getting money back: claim -> the store's agent -> Chaperone's advice -> owner decides -> PayPal refund or dispute. Then learn: optionally block the store.
import crypto from "node:crypto";
import { demoNow } from "./clock";
import { readDb, updateDb } from "./db";
import { deliveryNow, isLate } from "./delivery";
import { log } from "./log";
import { merchantReply } from "./merchant-bots";
import { usd, toValue } from "./money";
import { acceptClaim, CHARGEBACK_REASON, getDispute, refundCapture, simulateChargeback } from "./paypal";
import { PurchaseError } from "./purchases";
import { judgeOffer, writeClaim } from "./recovery-ai";
import { findBlockedMerchant } from "./rules";
import type { CaseProblem, Purchase, RecoveryCase } from "./types";

const PAID = new Set(["paid", "approved_by_owner"]);

function timelineFor(p: Purchase, problem: CaseProblem, now: Date, ownerNote?: string) {
  const t: { at: string; event: string }[] = [
    { at: p.createdAt, event: `You asked ${p.request.agent}: "${p.request.ownerInstruction}"` },
    { at: p.createdAt, event: `${p.request.agent} ordered ${p.request.items.map((i) => i.name).join(", ")} from ${p.request.merchant.name}` },
    { at: p.owner?.at ?? p.createdAt, event: `Paid ${usd(p.total)} with PayPal (capture ${p.paypal.captureId ?? "n/a"})` },
  ];
  const d = p.delivery;
  if (d?.shippedAt) t.push({ at: d.shippedAt, event: `Shipped with ${d.carrier} ${d.trackingNumber}${d.trackedInPayPal ? ", tracking registered on the PayPal order" : ""}` });
  if (d) t.push({ at: d.promisedBy, event: `Store's promised ship-by date` });
  t.push({
    at: now.toISOString(),
    event: problem === "not_delivered" ? "Still not shipped, past the promised date" : `You reported it arrived damaged${ownerNote ? `: "${ownerNote}"` : ""}`,
  });
  return t.sort((a, b) => a.at.localeCompare(b.at));
}

export async function openCase(purchaseId: string, problem: CaseProblem, openedBy: RecoveryCase["openedBy"], ownerNote?: string): Promise<RecoveryCase> {
  const db = await readDb();
  const p = db.purchases.find((x) => x.id === purchaseId);
  if (!p) throw new PurchaseError("Purchase not found.", 404);
  if (!PAID.has(p.status) || !p.paypal.captureId) throw new PurchaseError("Only paid purchases can be claimed.", 409);
  if (db.cases.some((c) => c.purchaseId === purchaseId && c.status !== "closed")) throw new PurchaseError("There is already an open case for this purchase.", 409);

  const now = demoNow(db);
  const timeline = timelineFor(p, problem, now, ownerNote);
  const { claim, askFor } = await writeClaim({ purchase: p, problem, ownerNote, timeline });
  const reply = merchantReply(p, problem);
  const c: RecoveryCase = {
    id: `case_${crypto.randomUUID().slice(0, 8)}`,
    purchaseId,
    createdAt: now.toISOString(),
    problem,
    openedBy,
    ownerNote,
    timeline,
    askFor,
    messages: [
      { from: "chaperone", at: now.toISOString(), text: claim, offer: askFor },
      { from: "merchant", at: now.toISOString(), text: reply.text, offer: reply.offer },
    ],
    status: "offer_to_review",
  };
  c.recommendation = await judgeOffer({ purchase: p, recoveryCase: c, offer: reply.offer, merchantText: reply.text });
  await updateDb((d) => {
    d.cases.unshift(c);
  });
  log("case.opened", { id: c.id, purchaseId, problem, offer: reply.offer.kind, advice: c.recommendation.action });
  return c;
}

/** Chaperone's watchdog: open a case by itself when a paid order is past its ship-by date. */
export async function checkDeliveries(): Promise<number> {
  const db = await readDb();
  const now = demoNow(db);
  const late = db.purchases.filter(
    (p) => PAID.has(p.status) && p.delivery && isLate(p.delivery, now) && !db.cases.some((c) => c.purchaseId === p.id),
  );
  for (const p of late) {
    try {
      await openCase(p.id, "not_delivered", "chaperone");
    } catch (e) {
      log("case.auto_open_failed", { id: p.id, error: (e as Error).message });
    }
  }
  return late.length;
}

export async function resolveCase(caseId: string, action: "accept" | "escalate"): Promise<RecoveryCase> {
  const db = await readDb();
  const c = db.cases.find((x) => x.id === caseId);
  if (!c) throw new PurchaseError("Case not found.", 404);
  if (c.status !== "offer_to_review") throw new PurchaseError("This case is not waiting for your decision.", 409);
  const p = db.purchases.find((x) => x.id === c.purchaseId)!;
  const offer = c.messages.filter((m) => m.from === "merchant").at(-1)?.offer;
  const now = demoNow(db).toISOString();
  const patch: Partial<RecoveryCase> = {};
  const messages = [...c.messages];

  if (action === "accept" && offer && offer.kind !== "none") {
    const r = await refundCapture(p.paypal.captureId!, { currency_code: "USD", value: toValue(offer.amount) }, `Refund from ${p.request.merchant.name}, agreed with your Chaperone agent`);
    patch.refund = { refundId: r.refundId, amount: offer.amount, status: r.status };
    patch.status = "refunded";
    messages.push({ from: "owner", at: now, text: `You accepted ${usd(offer.amount)}.` });
    messages.push({ from: "paypal", at: now, text: `PayPal refunded ${usd(offer.amount)} to you (refund ${r.refundId}, ${r.status.toLowerCase()}).` });
  } else {
    const note = `${c.problem === "not_delivered" ? "Paid order never shipped" : "Item arrived damaged"}. ${c.messages[0].text}`.slice(0, 200);
    const { disputeId } = await simulateChargeback({ captureId: p.paypal.captureId!, amount: { currency_code: "USD", value: toValue(p.total) }, note, reasonCode: CHARGEBACK_REASON[c.problem] });
    if (!disputeId) throw new PurchaseError("PayPal did not return a dispute ID.", 502);
    patch.dispute = { disputeId, status: "OPEN", updatedAt: now };
    patch.status = "escalated";
    messages.push({ from: "owner", at: now, text: "You asked Chaperone to escalate to PayPal." });
    messages.push({ from: "paypal", at: now, text: `PayPal opened case ${disputeId} for ${usd(p.total)} and asked ${p.request.merchant.name} to respond.` });
  }
  patch.messages = messages;
  const updated = await updateDb((d) => {
    const x = d.cases.find((k) => k.id === caseId)!;
    Object.assign(x, patch);
    return x;
  });
  log("case.resolved", { id: caseId, action, status: updated.status });
  return updated;
}

const DISPUTE_WORDS: Record<string, string> = {
  OPEN: "PayPal opened the case.",
  WAITING_FOR_SELLER_RESPONSE: "PayPal is waiting for the store to respond.",
  WAITING_FOR_BUYER_RESPONSE: "PayPal is waiting for your response.",
  UNDER_REVIEW: "PayPal is reviewing the case and decides who gets the money.",
  RESOLVED: "PayPal resolved the case.",
  OTHER: "PayPal is handling the case.",
};
export const disputeInWords = (status: string) => DISPUTE_WORDS[status] ?? DISPUTE_WORDS.OTHER;

export async function refreshDispute(caseId: string): Promise<RecoveryCase> {
  const db = await readDb();
  const c = db.cases.find((x) => x.id === caseId);
  if (!c?.dispute) throw new PurchaseError("This case has no PayPal dispute.", 409);
  const d = await getDispute(c.dispute.disputeId);
  return updateDb((db2) => {
    const x = db2.cases.find((k) => k.id === caseId)!;
    const changed = x.dispute!.status !== d.status;
    x.dispute = { disputeId: d.dispute_id, status: d.status, stage: d.dispute_life_cycle_stage, updatedAt: new Date().toISOString() };
    if (changed) x.messages.push({ from: "paypal", at: demoNow(db2).toISOString(), text: disputeInWords(d.status) });
    return x;
  });
}

/** Demo control: play the store and accept the claim, as PayPal would require once the deadline passes. */
export async function demoStoreAcceptsClaim(caseId: string): Promise<RecoveryCase> {
  const db = await readDb();
  const c = db.cases.find((x) => x.id === caseId);
  if (!c?.dispute) throw new PurchaseError("This case has no PayPal dispute.", 409);
  await acceptClaim(c.dispute.disputeId, "The order was never shipped. We accept the buyer's claim.");
  await new Promise((r) => setTimeout(r, 3000));
  return refreshDispute(caseId);
}

/**
 * Learn from a bad order: put the store on the owner's blocked list, so the agent can never pay it again.
 * Also adds a sentence to the owner's own rules text, so re-saving the rules keeps the block.
 */
export async function blockStoreFromCase(caseId: string): Promise<{ store: string; note: string }> {
  return updateDb((db) => {
    const c = db.cases.find((x) => x.id === caseId);
    if (!c) throw new PurchaseError("Case not found.", 404);
    const p = db.purchases.find((x) => x.id === c.purchaseId);
    if (!p) throw new PurchaseError("Purchase not found.", 404);
    const policy = db.policy;
    if (!policy) throw new PurchaseError("Set your rules first.", 409);

    const store = p.request.merchant.name.trim();
    const existing = findBlockedMerchant(policy, store);
    if (existing) return { store, note: policy.blockedMerchantNotes?.[existing.trim().toLowerCase()] ?? "" };

    const day = new Date(p.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const note = c.problem === "not_delivered" ? `the order on ${day} never shipped` : `the order on ${day} arrived damaged`;
    policy.blockedMerchants.push(store);
    policy.blockedMerchantNotes = { ...policy.blockedMerchantNotes, [store.toLowerCase()]: note };
    policy.explanation.push(`Never buy from ${store}. You blocked it after ${note}.`);
    const sentence = `Never buy from ${store}.`;
    if (!db.rulesText?.includes(sentence)) db.rulesText = db.rulesText ? `${db.rulesText.trimEnd()} ${sentence}` : sentence;
    log("rules.store_blocked", { caseId, store });
    return { store, note };
  });
}

export { deliveryNow };
