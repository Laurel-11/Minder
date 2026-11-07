// Getting money back: claim -> the store's agent -> Minder's advice -> owner decides -> PayPal refund or dispute. Then learn: optionally block the store.
import crypto from "node:crypto";
import { demoNow } from "./clock";
import { readDb, updateDb } from "./db";
import { deliveryNow, isLate } from "./delivery";
import { log } from "./log";
import { merchantReply } from "./merchant-bots";
import { usd, toValue } from "./money";
import { disputeInWords, outcomeInWords } from "./case-money";
import { CHARGEBACK_REASON, getDispute, simulateChargeback } from "./paypal";
import { PurchaseError } from "./purchases";
import { addReceipt, citedReceipts, claimReceipt, disputeReceipt, disputeUpdateReceipt, evidenceTag, refundReceipt } from "./receipts";
import { judgeOffer, writeClaim } from "./recovery-ai";
import { findBlockedMerchant } from "./rules";
import { storeAnswersDispute, storeRefunds } from "./store-agent";
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
  const cites = citedReceipts(db, purchaseId);
  const evidence = cites.length
    ? `\n\nEvidence: Minder's signed receipts ${cites.map((r) => `#${r.n}`).join(", ")} for this order${p.paypal.receiptOnOrder ? `. The PayPal order ${p.paypal.orderId} carries the fingerprint of receipt #${cites[0].n}` : ""}.`
    : "";
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
      { from: "minder", at: now.toISOString(), text: claim + evidence, offer: askFor },
      { from: "merchant", at: now.toISOString(), text: reply.text, offer: reply.offer },
    ],
    status: "offer_to_review",
  };
  c.recommendation = await judgeOffer({ purchase: p, recoveryCase: c, offer: reply.offer, merchantText: reply.text });
  await updateDb((d) => {
    d.cases.unshift(c);
    addReceipt(d, claimReceipt(c, p, citedReceipts(d, purchaseId)));
  });
  log("case.opened", { id: c.id, purchaseId, problem, offer: reply.offer.kind, advice: c.recommendation.action });
  return c;
}

/** Minder's watchdog: open a case by itself when a paid order is past its ship-by date. */
export async function checkDeliveries(): Promise<number> {
  const db = await readDb();
  const now = demoNow(db);
  const late = db.purchases.filter(
    (p) => PAID.has(p.status) && p.delivery && isLate(p.delivery, now) && !db.cases.some((c) => c.purchaseId === p.id),
  );
  for (const p of late) {
    try {
      await openCase(p.id, "not_delivered", "minder");
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
    messages.push({ from: "owner", at: now, text: `You accepted ${usd(offer.amount)}.` });
    // The store pays the refund, not Minder: its agent issues it through PayPal's Agent Toolkit.
    const r = await storeRefunds({ store: p.request.merchant.name, captureId: p.paypal.captureId!, amount: offer.amount, reason: c.problem === "damaged" ? "item arrived damaged" : "order never arrived" });
    patch.refund = { refundId: r.refundId, amount: offer.amount, status: r.status };
    patch.status = "refunded";
    messages.push({ from: "merchant", at: now, text: r.action.message });
    messages.push({ from: "paypal", at: now, text: `PayPal refunded ${usd(offer.amount)} to you (refund ${r.refundId}, ${r.status.toLowerCase()}). ${p.request.merchant.name}'s agent sent it with PayPal's Agent Toolkit.` });
  } else {
    // PayPal's case starts with a pointer to Minder's signed receipts for this order.
    const tag = evidenceTag(citedReceipts(db, p.id));
    const note = `${tag ? `${tag} ` : ""}${c.problem === "not_delivered" ? "Paid order never shipped" : "Item arrived damaged"}. ${c.messages[0].text}`.slice(0, 200);
    const { disputeId } = await simulateChargeback({ captureId: p.paypal.captureId!, amount: { currency_code: "USD", value: toValue(p.total) }, note, reasonCode: CHARGEBACK_REASON[c.problem] });
    if (!disputeId) throw new PurchaseError("PayPal did not return a dispute ID.", 502);
    patch.dispute = { disputeId, status: "OPEN", updatedAt: now };
    patch.status = "escalated";
    messages.push({ from: "owner", at: now, text: "You asked Minder to escalate to PayPal." });
    messages.push({ from: "paypal", at: now, text: `PayPal opened case ${disputeId} for ${usd(p.total)} and asked ${p.request.merchant.name} to respond.` });
  }
  patch.messages = messages;
  const updated = await updateDb((d) => {
    const x = d.cases.find((k) => k.id === caseId)!;
    Object.assign(x, patch);
    if (patch.refund) addReceipt(d, refundReceipt(x, p, now));
    else if (patch.dispute) addReceipt(d, disputeReceipt(x, p, now, citedReceipts(d, p.id), CHARGEBACK_REASON[x.problem]));
    return x;
  });
  log("case.resolved", { id: caseId, action, status: updated.status });
  return updated;
}

export { disputeInWords };

export async function refreshDispute(caseId: string): Promise<RecoveryCase> {
  const db = await readDb();
  const c = db.cases.find((x) => x.id === caseId);
  if (!c?.dispute) throw new PurchaseError("This case has no PayPal dispute.", 409);
  const d = await getDispute(c.dispute.disputeId);
  const outcome = (d as { dispute_outcome?: { outcome_code?: string; amount_refunded?: { value?: string } } }).dispute_outcome;
  return updateDb((db2) => {
    const x = db2.cases.find((k) => k.id === caseId)!;
    if (x.status === "closed") return x;
    const changed = x.dispute!.status !== d.status;
    const resolved = d.status === "RESOLVED";
    const amount = Number(outcome?.amount_refunded?.value ?? d.dispute_amount?.value ?? 0) || undefined;
    x.dispute = {
      disputeId: d.dispute_id,
      status: d.status,
      stage: d.dispute_life_cycle_stage,
      updatedAt: new Date().toISOString(),
      ...(resolved && { outcome: outcome?.outcome_code ?? "RESOLVED", amount }),
    };
    const at = demoNow(db2).toISOString();
    if (resolved) {
      x.status = "closed";
      const text = outcomeInWords(outcome?.outcome_code, amount ? usd(amount) : "");
      x.messages.push({ from: "paypal", at, text });
      addReceipt(db2, disputeUpdateReceipt(x, at, text));
    } else if (changed) {
      x.messages.push({ from: "paypal", at, text: disputeInWords(d.status) });
      addReceipt(db2, disputeUpdateReceipt(x, at, disputeInWords(d.status)));
    }
    return x;
  });
}

const answering = new Set<string>();

/**
 * The store's turn in a PayPal dispute. On the live site PayPal's webhook starts this as soon as PayPal passes the
 * case to the store; the case page also has a button for it. The store's agent reads the dispute and answers it
 * with PayPal's Agent Toolkit.
 */
export async function storeAnswersCase(caseId: string): Promise<RecoveryCase> {
  const db = await readDb();
  const c = db.cases.find((x) => x.id === caseId);
  if (!c?.dispute) throw new PurchaseError("This case has no PayPal dispute.", 409);
  if (answering.has(caseId)) throw new PurchaseError("The store's agent is already answering.", 409);
  const p = db.purchases.find((x) => x.id === c.purchaseId)!;
  answering.add(caseId);
  try {
    const r = await storeAnswersDispute({ store: p.request.merchant.name, disputeId: c.dispute.disputeId, problem: c.problem });
    if (!r.answered) {
      throw new PurchaseError(
        r.status === "RESOLVED" ? "PayPal has already closed this case." : `PayPal has not passed the case to the store yet (${r.status.toLowerCase().replaceAll("_", " ")}). Try again in a minute.`,
        409,
      );
    }
    await updateDb((d) => {
      const x = d.cases.find((k) => k.id === caseId)!;
      x.messages.push({ from: "merchant", at: demoNow(d).toISOString(), text: `${r.action.message} (answered in PayPal with the Agent Toolkit)` });
    });
    await new Promise((res) => setTimeout(res, 3000));
    return refreshDispute(caseId);
  } finally {
    answering.delete(caseId);
  }
}

/** Kept for the case page's button. */
export const demoStoreAcceptsClaim = storeAnswersCase;

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
    addReceipt(db, { at: demoNow(db).toISOString(), kind: "store_blocked", purchaseId: p.id, caseId: c.id, says: `You blocked ${store}: ${note}. Minder will not pay it again.`, facts: { store, note, rulesText: db.rulesText } });
    log("rules.store_blocked", { caseId, store });
    return { store, note };
  });
}

export { deliveryNow };
