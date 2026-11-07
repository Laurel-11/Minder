// The full pipeline for one purchase request: rules -> AI review -> decision -> PayPal. assessPurchase is the shared first half.
import crypto from "node:crypto";
import { demoNow } from "./clock";
import { readDb, updateDb } from "./db";
import { shipAfterPayment } from "./delivery";
import { log } from "./log";
import { toValue } from "./money";
import { checkMarket, marketRule } from "./market";
import { captureAuthorization, createVaultedOrder, voidAuthorization } from "./paypal";
import { addReceipt, decisionReceipt, deliveryReceipt, ownerReceipt, paypalReceipt } from "./receipts";
import { reviewPurchase } from "./review";
import { evaluateRules, worst } from "./rules";
import type { Outcome, Policy, Purchase, PurchaseRequest } from "./types";

export class PurchaseError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/**
 * Steps 1 and 2 of every purchase: hard rules, then the AI review, then the combined decision.
 * Shared by real purchases and the self-test exam, so the exam grades exactly what runs in production.
 */
export async function assessPurchase(input: { policy: Policy; rulesText?: string; request: PurchaseRequest; history: Purchase[]; now?: Date; liveOnly?: boolean }) {
  const { policy, request, history } = input;

  // 1. Hard rules (plain code). The AI can never loosen these.
  const rules = evaluateRules(policy, request, history, input.now);

  // 1b. What other stores charge (Channel3). Also plain code: far above the market price waits for the owner.
  const market = rules.outcome === "block" ? null : await checkMarket(request);
  const priceCheck = marketRule(market);
  if (priceCheck) {
    rules.checks.push(priceCheck);
    rules.outcome = worst(rules.outcome, priceCheck.outcome);
  }

  // 2. AI review. If the AI is down, fail safe: anything not blocked waits for the owner.
  let ai: Purchase["ai"] = null;
  let aiError: string | undefined;
  if (rules.outcome !== "block") {
    try {
      ai = await reviewPurchase({ request, total: rules.total, rulesText: input.rulesText, recent: history, liveOnly: input.liveOnly, market });
    } catch (e) {
      aiError = (e as Error).message;
    }
  }
  const decision: Outcome = worst(rules.outcome, ai?.verdict ?? (aiError ? "hold" : "approve"));

  // Show only the reasons that explain the final decision (a block should not also say "you decide").
  const reasons = rules.checks.filter((c) => c.outcome === decision).map((c) => c.message);
  if (ai && (ai.verdict === decision || decision === "hold")) reasons.push(ai.summaryForOwner);
  if (aiError && decision === "hold") reasons.push("The AI reviewer was unavailable, so Minder is asking you to decide.");
  if (decision === "approve") {
    // For an approval, the useful lines are what the AI saw and how much budget is left, not every passed check.
    reasons.length = 0;
    if (ai) reasons.push(ai.summaryForOwner);
    reasons.push(...rules.checks.filter((c) => c.rule.includes("budget")).map((c) => c.message));
    if (reasons.length === 0) reasons.push("Within all of your rules.");
  }
  if (ai?.recorded) reasons.push("The live AI reviewer was unavailable, so this is its recorded review of this exact order.");
  return { rules, ai, aiError, decision, reasons, market };
}

export async function handlePurchaseRequest(request: PurchaseRequest): Promise<Purchase> {
  const db = await readDb();
  if (!db.vault) throw new PurchaseError("The owner has not connected PayPal yet.", 409);
  // PayPal's webhook said the owner took Minder's permission away in their PayPal account: pay nothing.
  if (db.vaultRevokedAt) throw new PurchaseError("The owner removed Minder's permission to pay in their PayPal account. Reconnect PayPal to let the agent pay again.", 409);
  if (!db.policy) throw new PurchaseError("The owner has not written any rules yet.", 409);

  const { rules, ai, aiError, decision, reasons, market } = await assessPurchase({
    policy: db.policy,
    rulesText: db.rulesText,
    request,
    history: db.purchases,
    now: demoNow(db),
  });

  const purchase: Purchase = {
    id: `pur_${crypto.randomUUID().slice(0, 8)}`,
    createdAt: demoNow(db).toISOString(),
    request,
    total: rules.total,
    rules: { outcome: rules.outcome, checks: rules.checks },
    ai,
    aiError,
    ...(market && { market }),
    decision,
    reasons,
    status: decision === "block" ? "blocked" : decision === "hold" ? "awaiting_owner" : "paid",
    paypal: {},
  };

  // 3. Write the decision down, then move the money (or not). The decision receipt comes first, so its
  // fingerprint can go on the PayPal order itself: PayPal's record then points at Minder's signed receipt.
  if (decision === "block") {
    await updateDb((d) => {
      d.purchases.unshift(purchase);
      addReceipt(d, decisionReceipt(purchase, db.rulesText));
    });
  } else {
    const decided = await updateDb((d) => addReceipt(d, decisionReceipt(purchase, db.rulesText)));
    try {
      const order = await createVaultedOrder({
        vaultId: db.vault.vaultId,
        intent: decision === "approve" ? "CAPTURE" : "AUTHORIZE",
        amount: { currency_code: "USD", value: toValue(rules.total) },
        description: `${request.merchant.name}: ${request.items.map((i) => i.name).join(", ")}`,
        referenceId: purchase.id,
        customId: decided.hash,
      });
      purchase.paypal = { orderId: order.orderId, authorizationId: order.authorizationId, captureId: order.captureId, receiptOnOrder: decided.hash };
      if (decision === "approve") purchase.delivery = await shipAfterPayment(purchase, demoNow(db));
    } catch (e) {
      purchase.status = "payment_failed";
      purchase.paypal.error = (e as Error).message;
    }
    await updateDb((d) => {
      d.purchases.unshift(purchase);
      const at = demoNow(d).toISOString();
      addReceipt(d, paypalReceipt(purchase, at));
      const shipped = deliveryReceipt(purchase, at);
      if (shipped) addReceipt(d, shipped);
    });
  }
  log("purchase.decided", { id: purchase.id, decision, status: purchase.status, total: purchase.total, ai: ai?.verdict ?? aiError ?? "skipped" });
  return purchase;
}

export async function decideHeldPurchase(id: string, decision: "approve" | "decline"): Promise<Purchase> {
  const db = await readDb();
  const purchase = db.purchases.find((p) => p.id === id);
  if (!purchase) throw new PurchaseError("Purchase not found.", 404);
  if (purchase.status !== "awaiting_owner") throw new PurchaseError("This purchase is not waiting for a decision.", 409);
  const authId = purchase.paypal.authorizationId;
  if (!authId) throw new PurchaseError("No held payment found for this purchase.", 409);

  const patch: Partial<Purchase> = { owner: { decision, at: demoNow(db).toISOString() } };
  if (decision === "approve") {
    const { captureId } = await captureAuthorization(authId);
    patch.status = "approved_by_owner";
    patch.paypal = { ...purchase.paypal, captureId };
    patch.delivery = await shipAfterPayment({ ...purchase, paypal: patch.paypal }, demoNow(db));
  } else {
    await voidAuthorization(authId);
    patch.status = "declined_by_owner";
  }
  const updated = await updateDb((d) => {
    const p = d.purchases.find((x) => x.id === id)!;
    Object.assign(p, patch);
    addReceipt(d, ownerReceipt(p));
    const shipped = deliveryReceipt(p, demoNow(d).toISOString());
    if (shipped) addReceipt(d, shipped);
    return p;
  });
  log("purchase.owner_decision", { id, decision, status: updated.status });
  return updated;
}
