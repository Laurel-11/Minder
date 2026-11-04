// Server half of the tools Chaperone's own AI agents use inside AG Studio: look a purchase up,
// check it against PayPal's records, and replay past purchases under different rules. All three
// only read; the one thing that moves money (approving a held purchase) stays a button the owner
// presses.
import { checkpointOf, DECISION_LABEL, STATUS_LABEL } from "./dashboard-data";
import { usd } from "./money";
import { getDispute, getOrder, getRefund } from "./paypal";
import { evaluateRules, worst } from "./rules";
import { CATEGORIES, type Category, type Db, type Outcome, type Period, type Policy, type Purchase, type RecoveryCase } from "./types";

type J = Record<string, unknown>;

export type PurchaseRecord = {
  purchaseId: string;
  date: string;
  store: string;
  agent: string;
  ownerAsked: string;
  items: { name: string; quantity: number; unitPrice: number; category: string }[];
  total: number;
  decision: string;
  status: string;
  whichCheck: string;
  reasons: string[];
  failedRules: { rule: string; outcome: string; message: string }[];
  ai: { verdict: string; matchesRequest: boolean; manipulationSuspected: boolean; storeSaid: string; summary: string } | null;
  paypal: { orderId?: string; authorizationId?: string; captureId?: string };
  case: { caseId: string; problem: string; status: string; refunded?: number; disputeId?: string; disputeStatus?: string } | null;
  waitingForOwner: boolean;
};

export function toRecord(p: Purchase, cases: RecoveryCase[]): PurchaseRecord {
  const c = cases.find((x) => x.purchaseId === p.id);
  return {
    purchaseId: p.id,
    date: p.createdAt,
    store: p.request.merchant.name,
    agent: p.request.agent,
    ownerAsked: p.request.ownerInstruction,
    items: p.request.items.map((i) => ({ name: i.name, quantity: i.quantity, unitPrice: i.unitPrice, category: i.category.replace("_", " ") })),
    total: p.total,
    decision: DECISION_LABEL[p.decision],
    status: STATUS_LABEL[p.status],
    whichCheck: checkpointOf(p),
    reasons: p.reasons,
    failedRules: p.rules.checks.filter((r) => r.outcome !== "approve").map((r) => ({ rule: r.rule, outcome: DECISION_LABEL[r.outcome], message: r.message })),
    ai: p.ai
      ? {
          verdict: DECISION_LABEL[p.ai.verdict],
          matchesRequest: p.ai.matchesInstruction,
          manipulationSuspected: p.ai.manipulationSuspected,
          storeSaid: p.ai.manipulationSuspected ? p.ai.manipulationEvidence : "",
          summary: p.ai.summaryForOwner,
        }
      : null,
    paypal: { orderId: p.paypal.orderId, authorizationId: p.paypal.authorizationId, captureId: p.paypal.captureId },
    case: c
      ? {
          caseId: c.id,
          problem: c.problem === "damaged" ? "Arrived damaged" : "Never arrived",
          status: c.status,
          refunded: c.refund?.amount,
          disputeId: c.dispute?.disputeId,
          disputeStatus: c.dispute?.status,
        }
      : null,
    waitingForOwner: p.status === "awaiting_owner",
  };
}

/** Find purchases by id, store, item or the owner's words. Newest first. */
export function findPurchases(db: Db, query: string, limit = 3): PurchaseRecord[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const exact = db.purchases.find((p) => p.id.toLowerCase() === q);
  if (exact) return [toRecord(exact, db.cases)];
  const words = q.split(/\s+/).filter((w) => w.length > 2 && !["the", "and", "for", "purchase", "order", "from", "what", "why", "was"].includes(w));
  const haystack = (p: Purchase) =>
    [p.id, p.request.merchant.name, p.request.ownerInstruction, ...p.request.items.map((i) => i.name), p.status, STATUS_LABEL[p.status]].join(" ").toLowerCase();
  const scored = db.purchases
    .map((p) => ({ p, score: haystack(p).includes(q) ? 100 : words.filter((w) => haystack(p).includes(w)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.p.createdAt.localeCompare(a.p.createdAt));
  return scored.slice(0, limit).map((x) => toRecord(x.p, db.cases));
}

export type PayPalCheck = { label: string; chaperone: string; paypal: string; match: boolean };
export type Verification = { purchaseId: string; store: string; orderId?: string; checks: PayPalCheck[]; allMatch: boolean; summary: string };

const amountOf = (a: unknown) => Number((a as { value?: string } | undefined)?.value ?? NaN);

/** Ask PayPal itself what happened to a purchase's money, and compare it with Chaperone's own record. */
export async function verifyWithPayPal(db: Db, purchaseId: string): Promise<Verification> {
  const p = db.purchases.find((x) => x.id === purchaseId);
  if (!p) throw new Error(`No purchase ${purchaseId}.`);
  const store = p.request.merchant.name;
  if (!p.paypal.orderId) {
    const why = p.status === "blocked" ? "Chaperone blocked it before any PayPal order existed" : "There is no PayPal order for it";
    return { purchaseId, store, checks: [], allMatch: true, summary: `${why}, so no money could move. Nothing to check in PayPal.` };
  }

  const checks: PayPalCheck[] = [];
  const order = await getOrder(p.paypal.orderId);
  const unit = ((order.purchase_units as J[]) ?? [])[0] ?? {};
  const payments = (unit.payments ?? {}) as { captures?: J[]; authorizations?: J[] };
  const captures = payments.captures ?? [];
  const auths = payments.authorizations ?? [];
  const orderAmount = amountOf(unit.amount);
  checks.push({ label: "Order amount", chaperone: usd(p.total), paypal: Number.isNaN(orderAmount) ? "Not shown" : usd(orderAmount), match: Math.abs(orderAmount - p.total) < 0.005 });

  const captured = captures.filter((c) => c.status === "COMPLETED" || c.status === "PARTIALLY_REFUNDED" || c.status === "REFUNDED");
  const capturedSum = captured.reduce((s, c) => s + (amountOf(c.amount) || 0), 0);
  const authStatus = (auths[0]?.status as string | undefined) ?? "";
  const moneyMoved = p.status === "paid" || p.status === "approved_by_owner";
  if (moneyMoved) {
    checks.push({ label: "Money sent to the store", chaperone: usd(p.total), paypal: captured.length ? `${usd(capturedSum)} captured` : "Nothing captured", match: Math.abs(capturedSum - p.total) < 0.005 });
  } else if (p.status === "awaiting_owner") {
    checks.push({ label: "Money held, not sent", chaperone: "Held until you decide", paypal: authStatus ? `Authorization ${authStatus.toLowerCase()}` : "No authorization", match: authStatus === "CREATED" && captured.length === 0 });
  } else if (p.status === "declined_by_owner") {
    checks.push({ label: "Hold released", chaperone: "You declined it", paypal: authStatus ? `Authorization ${authStatus.toLowerCase()}` : "No authorization", match: authStatus === "VOIDED" && captured.length === 0 });
  } else {
    checks.push({ label: "No money sent", chaperone: STATUS_LABEL[p.status], paypal: captured.length ? `${usd(capturedSum)} captured` : "Nothing captured", match: captured.length === 0 });
  }

  const c = db.cases.find((x) => x.purchaseId === p.id);
  if (c?.refund) {
    const r = await getRefund(c.refund.refundId);
    const amt = amountOf(r.amount);
    checks.push({ label: "Refund", chaperone: usd(c.refund.amount), paypal: `${Number.isNaN(amt) ? "?" : usd(amt)} ${String(r.status ?? "").toLowerCase()}`, match: Math.abs(amt - c.refund.amount) < 0.005 && r.status === "COMPLETED" });
  }
  if (c?.dispute) {
    const d = await getDispute(c.dispute.disputeId);
    checks.push({ label: "PayPal dispute", chaperone: c.dispute.status.toLowerCase().replaceAll("_", " "), paypal: String(d.status ?? "").toLowerCase().replaceAll("_", " "), match: d.status === c.dispute.status });
  }

  const allMatch = checks.every((x) => x.match);
  const summary = allMatch
    ? `PayPal's records agree with Chaperone on all ${checks.length} checks for the ${store} order.`
    : `PayPal disagrees with Chaperone on ${checks.filter((x) => !x.match).map((x) => x.label.toLowerCase()).join(", ")}.`;
  return { purchaseId, store, orderId: p.paypal.orderId, checks, allMatch, summary };
}

export type RuleChanges = {
  approvalThreshold?: number;
  perPurchaseMax?: number | null;
  budgetLimit?: number;
  budgetPeriod?: Period;
  blockStores?: string[];
  unblockStores?: string[];
  blockCategories?: string[];
  allowCategories?: string[];
};
export type WhatIfRow = { purchaseId: string; date: string; store: string; total: number; before: string; after: string; changed: boolean; why: string };
export type WhatIf = { changes: string[]; rows: WhatIfRow[]; summary: string; changedCount: number };

const isCategory = (c: string): c is Category => (CATEGORIES as readonly string[]).includes(c);
const toCategory = (c: string) => c.trim().toLowerCase().replace(/\s+/g, "_");

function applyChanges(policy: Policy, ch: RuleChanges): { policy: Policy; described: string[] } {
  const next: Policy = structuredClone(policy);
  const described: string[] = [];
  if (typeof ch.approvalThreshold === "number") {
    next.approvalThreshold = ch.approvalThreshold;
    described.push(`Ask you first above ${usd(ch.approvalThreshold)} (now ${usd(policy.approvalThreshold)})`);
  }
  if (ch.perPurchaseMax !== undefined) {
    next.perPurchaseMax = ch.perPurchaseMax;
    described.push(ch.perPurchaseMax === null ? "No hard limit per purchase" : `Block anything over ${usd(ch.perPurchaseMax)}`);
  }
  if (next.budgets[0] && (typeof ch.budgetLimit === "number" || ch.budgetPeriod)) {
    const b = next.budgets[0];
    if (typeof ch.budgetLimit === "number") b.limit = ch.budgetLimit;
    if (ch.budgetPeriod) b.period = ch.budgetPeriod;
    described.push(`${b.label} budget of ${usd(b.limit)} a ${b.period} (now ${usd(policy.budgets[0].limit)} a ${policy.budgets[0].period})`);
  }
  for (const s of ch.blockStores ?? []) {
    if (s.trim()) {
      next.blockedMerchants = [...next.blockedMerchants, s.trim()];
      described.push(`Block ${s.trim()}`);
    }
  }
  for (const s of ch.unblockStores ?? []) {
    const k = s.trim().toLowerCase();
    next.blockedMerchants = next.blockedMerchants.filter((m) => !m.toLowerCase().includes(k) && !k.includes(m.toLowerCase()));
    described.push(`Unblock ${s.trim()}`);
  }
  for (const c of (ch.blockCategories ?? []).map(toCategory).filter(isCategory)) {
    next.blockedCategories = [...new Set([...next.blockedCategories, c])];
    described.push(`Never allow ${c.replace("_", " ")}`);
  }
  for (const c of (ch.allowCategories ?? []).map(toCategory).filter(isCategory)) {
    next.blockedCategories = next.blockedCategories.filter((x) => x !== c);
    described.push(`Allow ${c.replace("_", " ")}`);
  }
  return { policy: next, described };
}

const LABEL: Record<Outcome, string> = { approve: "Approved", hold: "Asked you", block: "Blocked" };

/**
 * Replay every past purchase, oldest first, through the same rules code Chaperone runs, under the
 * changed rules. The AI review is not re-run: where it ran, its verdict is kept; where the code
 * limits stopped a purchase before it, the replay says the AI would now have to look.
 */
export function simulateRules(db: Db, changes: RuleChanges): WhatIf {
  if (!db.policy) throw new Error("The owner has no rules yet.");
  const { policy, described } = applyChanges(db.policy, changes);
  if (!described.length) throw new Error("No rule change given. Say what to change, e.g. approvalThreshold or budgetLimit.");
  const oldestFirst = [...db.purchases].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const rows: WhatIfRow[] = oldestFirst.map((p, i) => {
    const history = oldestFirst.slice(0, i);
    const rules = evaluateRules(policy, p.request, history, new Date(p.createdAt));
    let after: string;
    if (rules.outcome === "block") after = LABEL.block;
    else if (p.ai) after = LABEL[worst(rules.outcome, p.ai.verdict)];
    else after = rules.outcome === "hold" ? LABEL.hold : "AI review decides";
    const before = LABEL[p.decision];
    const firing = rules.checks.find((c) => c.outcome === rules.outcome && c.outcome !== "approve");
    const why = firing?.message ?? (p.ai && after !== LABEL.approve ? p.ai.summaryForOwner : after === "AI review decides" ? "The code limits no longer stop it, so the AI review would look at it." : "Within all of the rules.");
    return { purchaseId: p.id, date: p.createdAt, store: p.request.merchant.name, total: p.total, before, after, changed: before !== after, why };
  });
  const changed = rows.filter((r) => r.changed);
  const summary = changed.length
    ? `${changed.length} of ${rows.length} past purchases would have gone differently: ${changed.map((r) => `${r.store} ${usd(r.total)} ${r.before.toLowerCase()} to ${r.after.toLowerCase()}`).join("; ")}.`
    : `None of the ${rows.length} past purchases would have gone differently.`;
  return { changes: described, rows: rows.reverse(), summary, changedCount: changed.length };
}
