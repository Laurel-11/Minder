// Flattens Minder's purchase log and recovery cases into the tables the AG Studio dashboard reads.
// Every table that describes purchases carries purchaseId, so the dashboard can relate them and a
// click in one widget filters the others.
import type { Outcome, Policy, Purchase, PurchaseStatus, RecoveryCase } from "./types";
import { moneyBack } from "./case-money";

export const STATUS_LABEL: Record<PurchaseStatus, string> = {
  paid: "Approved",
  approved_by_owner: "Approved by you",
  awaiting_owner: "Waiting for you",
  declined_by_owner: "Declined by you",
  blocked: "Blocked",
  payment_failed: "Payment failed",
};
export const DECISION_LABEL: Record<Outcome, string> = { approve: "Approved", hold: "Asked you", block: "Blocked" };
const moneyMoved = (s: PurchaseStatus) => s === "paid" || s === "approved_by_owner";
const keptSafe = (s: PurchaseStatus) => s === "blocked" || s === "declined_by_owner";

/** Which of Minder's checks settled a purchase: the three layers, as the owner would name them. */
export function checkpointOf(p: Purchase): string {
  if (p.status === "blocked") return p.rules.outcome === "block" ? "Code limits" : "AI review";
  if (p.status === "awaiting_owner" || p.status === "approved_by_owner" || p.status === "declined_by_owner") return "Your signature";
  return "Passed every check";
}

/** What happened to the money at checkout. */
export function resultOf(p: Purchase): string {
  switch (p.status) {
    case "paid":
    case "approved_by_owner":
      return "Paid";
    case "blocked":
      return "Blocked";
    case "declined_by_owner":
      return "Declined";
    case "awaiting_owner":
      return "Waiting for you";
    default:
      return "Payment failed";
  }
}

const PROBLEM_LABEL = { not_delivered: "Never arrived", damaged: "Arrived damaged" } as const;
const CASE_STATUS_LABEL: Record<RecoveryCase["status"], string> = {
  offer_to_review: "Your decision",
  refunded: "Refunded",
  escalated: "With PayPal",
  closed: "Closed",
};
const DISPUTE_LABEL: Record<string, string> = {
  OPEN: "Opened",
  WAITING_FOR_SELLER_RESPONSE: "Waiting for the store",
  WAITING_FOR_BUYER_RESPONSE: "Waiting for you",
  UNDER_REVIEW: "PayPal reviewing",
  RESOLVED: "Resolved",
};

export type PurchaseRow = {
  purchaseId: string;
  date: string;
  merchant: string;
  agent: string;
  request: string;
  items: string;
  amount: number;
  decision: string;
  status: string;
  /** The check that settled it: "Code limits", "AI review", "Your signature" or "Passed every check". */
  whichCheck: string;
  /** "Paid", "Blocked", "Declined", "Waiting for you" or "Payment failed". */
  atCheckout: string;
  spent: number;
  keptSafe: number;
  /** Money recovered afterwards through a PayPal refund. */
  refunded: number;
  aiVerdict: string;
  manipulation: string;
  /** What the store's page said to the agent, when the AI review caught it steering the agent. */
  evidence: string;
  reason: string;
};

/** One row per verdict, always in this order, so chart colours stay green / amber / red. */
export type DecisionRow = { decision: string; purchases: number; amount: number };

/** The owner's first budget this period: what the gauge shows. */
export type BudgetRow = { budgetName: string; used: number; cap: number; remaining: number; per: string };

export type ItemRow = {
  purchaseId: string;
  date: string;
  merchant: string;
  item: string;
  category: string;
  amount: number;
  status: string;
  spent: number;
};

/**
 * Where every dollar went, as stages for the money-flow widget: asked, the check that settled it,
 * the result at checkout, and where the money is now. A partly refunded purchase becomes two rows,
 * so the refunded share can flow back to the owner.
 */
export type FlowRow = { purchaseId: string; merchant: string; askedToPay: string; whichCheck: string; atCheckout: string; whereNow: string; amount: number };

/** A store page caught steering the agent: the quote, and what came of it. */
export type TrickRow = { purchaseId: string; date: string; merchant: string; quote: string; aiNote: string; amount: number; paid: number; outcome: string };

/** A recovery case: a paid order that went wrong afterwards. */
export type CaseRow = {
  caseId: string;
  purchaseId: string;
  date: string;
  merchant: string;
  problem: string;
  openedBy: string;
  status: string;
  storeOffered: string;
  recovered: number;
  amount: number;
  disputeId: string;
  disputeStatus: string;
};

/** One step in a recovery case, in order: what happened, who did it, and when. */
export type CaseStepRow = { caseId: string; purchaseId: string; merchant: string; date: string; who: string; step: string; seq: number };

export type DashboardRows = {
  purchases: PurchaseRow[];
  items: ItemRow[];
  decisions: DecisionRow[];
  budget: BudgetRow[];
  flows: FlowRow[];
  tricks: TrickRow[];
  cases: CaseRow[];
  caseSteps: CaseStepRow[];
};

/**
 * The counterfactual: what ShopBot would have paid if every request had simply gone through,
 * against what actually left the owner's PayPal, and what came back afterwards.
 */
export function withAndWithout(purchases: Purchase[], cases: RecoveryCase[] = []) {
  const sum = (list: Purchase[]) => Math.round(list.reduce((s, p) => s + p.total, 0) * 100) / 100;
  const tricked = purchases.filter((p) => p.ai?.manipulationSuspected);
  return {
    /** Everything ShopBot asked to pay: what an unguarded agent would have spent. */
    withoutMinder: sum(purchases),
    /** The part of that on orders a store page had steered the agent into. */
    tricked: sum(tricked),
    trickedOrders: tricked.length,
    /** What actually left the owner's PayPal. */
    withMinder: sum(purchases.filter((p) => moneyMoved(p.status))),
    trickedPaid: sum(tricked.filter((p) => moneyMoved(p.status))),
    /** Money that came back afterwards: a refund the owner accepted, or a PayPal dispute won. */
    recovered: Math.round(cases.reduce((s, c) => s + refundOf(c), 0) * 100) / 100,
  };
}

const PERIOD_DAYS = { day: 1, week: 7, month: 30 } as const;
const unquote = (s: string) => s.trim().replace(/^["“”']+|["“”']+$/g, "").trim();

const refundOf = (c?: RecoveryCase): number => moneyBack(c);

export function buildDashboardRows(purchases: Purchase[], opts: { policy?: Policy; now?: Date; cases?: RecoveryCase[] } = {}): DashboardRows {
  const cases = opts.cases ?? [];
  const caseFor = (id: string) => cases.find((c) => c.purchaseId === id);

  const rows: PurchaseRow[] = purchases.map((p) => ({
    purchaseId: p.id,
    date: p.createdAt,
    merchant: p.request.merchant.name,
    agent: p.request.agent,
    request: p.request.ownerInstruction,
    items: p.request.items.map((i) => i.name).join(", "),
    amount: p.total,
    decision: DECISION_LABEL[p.decision],
    status: STATUS_LABEL[p.status],
    whichCheck: checkpointOf(p),
    atCheckout: resultOf(p),
    spent: moneyMoved(p.status) ? p.total : 0,
    keptSafe: keptSafe(p.status) ? p.total : 0,
    refunded: refundOf(caseFor(p.id)),
    aiVerdict: p.ai ? DECISION_LABEL[p.ai.verdict] : "Not run",
    manipulation: p.ai?.manipulationSuspected ? "Suspected" : "None found",
    evidence: p.ai?.manipulationSuspected ? unquote(p.ai.manipulationEvidence ?? "") : "",
    reason: p.reasons[0] ?? "",
  }));

  const items: ItemRow[] = purchases.flatMap((p) =>
    p.request.items.map((i) => ({
      purchaseId: p.id,
      date: p.createdAt,
      merchant: p.request.merchant.name,
      item: i.name,
      category: i.category.replace("_", " "),
      amount: i.unitPrice * i.quantity,
      status: STATUS_LABEL[p.status],
      spent: moneyMoved(p.status) ? i.unitPrice * i.quantity : 0,
    })),
  );

  const decisions: DecisionRow[] = (["approve", "hold", "block"] as Outcome[]).map((d) => {
    const these = purchases.filter((p) => p.decision === d);
    return { decision: DECISION_LABEL[d], purchases: these.length, amount: these.reduce((s, p) => s + p.total, 0) };
  });

  const b = opts.policy?.budgets[0];
  const budget: BudgetRow[] = [];
  if (b) {
    const since = (opts.now ?? new Date()).getTime() - PERIOD_DAYS[b.period] * 86_400_000;
    const spent = purchases
      .filter((p) => moneyMoved(p.status) && new Date(p.createdAt).getTime() >= since)
      .flatMap((p) => p.request.items)
      .filter((i) => b.categories.length === 0 || b.categories.includes(i.category))
      .reduce((s, i) => s + i.unitPrice * i.quantity, 0);
    budget.push({ budgetName: b.label, used: spent, cap: b.limit, remaining: Math.max(0, b.limit - spent), per: b.period });
  }

  const flows: FlowRow[] = purchases.flatMap((p) => {
    const base = { purchaseId: p.id, merchant: p.request.merchant.name, askedToPay: "ShopBot asked to pay", whichCheck: checkpointOf(p), atCheckout: resultOf(p) };
    if (p.status === "awaiting_owner") return [{ ...base, whereNow: "Held in PayPal", amount: p.total }];
    if (!moneyMoved(p.status)) return [{ ...base, whereNow: "Never left you", amount: p.total }];
    const c = caseFor(p.id);
    if (c?.status === "escalated") return [{ ...base, whereNow: "In a PayPal dispute", amount: p.total }];
    const back = Math.min(refundOf(c), p.total);
    const out: FlowRow[] = [];
    if (back > 0) out.push({ ...base, whereNow: "Refunded to you", amount: back });
    if (p.total - back > 0) out.push({ ...base, whereNow: "With the store", amount: Math.round((p.total - back) * 100) / 100 });
    return out;
  });

  const tricks: TrickRow[] = purchases
    .filter((p) => p.ai?.manipulationSuspected && unquote(p.ai.manipulationEvidence ?? ""))
    .map((p) => ({
      purchaseId: p.id,
      date: p.createdAt,
      merchant: p.request.merchant.name,
      quote: unquote(p.ai!.manipulationEvidence),
      aiNote: p.ai!.summaryForOwner,
      amount: p.total,
      paid: moneyMoved(p.status) ? p.total : 0,
      outcome: STATUS_LABEL[p.status],
    }));

  const caseRows: CaseRow[] = cases.flatMap((c) => {
    const p = purchases.find((x) => x.id === c.purchaseId);
    if (!p) return [];
    const offer = c.messages.filter((m) => m.from === "merchant").at(-1)?.offer;
    const offered = !offer || offer.kind === "none" ? "Refused" : offer.kind === "full_refund" ? "Full refund" : `$${offer.amount.toFixed(2)} back`;
    return [
      {
        caseId: c.id,
        purchaseId: c.purchaseId,
        date: c.createdAt,
        merchant: p.request.merchant.name,
        problem: PROBLEM_LABEL[c.problem],
        openedBy: c.openedBy === "minder" ? "Minder" : "You",
        status: CASE_STATUS_LABEL[c.status],
        storeOffered: offered,
        recovered: refundOf(c),
        amount: p.total,
        disputeId: c.dispute?.disputeId ?? "",
        disputeStatus: c.dispute ? (DISPUTE_LABEL[c.dispute.status] ?? c.dispute.status) : "",
      },
    ];
  });

  const WHO = { minder: "Minder", merchant: "The store", paypal: "PayPal", owner: "You" } as const;
  const firstSentence = (t: string) => (t.replace(/\s+/g, " ").match(/^.*?[.!?](\s|$)/)?.[0] ?? t).trim();
  let seq = 0;
  const caseSteps: CaseStepRow[] = cases.flatMap((c) => {
    const p = purchases.find((x) => x.id === c.purchaseId);
    if (!p) return [];
    const merchant = p.request.merchant.name;
    const fromTimeline = c.timeline.map((t) => ({
      at: t.at,
      who: t.event.startsWith("ShopBot")
        ? "ShopBot"
        : t.event.startsWith("Paid")
          ? "PayPal"
          : t.event.startsWith("Shipped") || t.event.startsWith("Store")
            ? "The store"
            : t.event.startsWith("You")
              ? "You"
              : "Minder",
      step: t.event.replace(/ \(capture [A-Z0-9]+\)/, ""),
    }));
    const fromMessages = c.messages.map((m) => {
      let step = firstSentence(m.text);
      if (m.from === "minder") step = `Minder wrote to ${merchant} with the evidence and asked for ${m.offer?.kind === "full_refund" ? `a full refund of $${m.offer.amount.toFixed(2)}` : "a refund"}.`;
      else if (m.from === "merchant") step = !m.offer || m.offer.kind === "none" ? `${merchant} refused: "${firstSentence(m.text)}"` : `${merchant} offered $${m.offer.amount.toFixed(2)} back.`;
      return { at: m.at, who: WHO[m.from], step };
    });
    return [...fromTimeline, ...fromMessages].map((x) => ({ caseId: c.id, purchaseId: c.purchaseId, merchant, date: x.at, who: x.who, step: x.step, seq: ++seq }));
  });

  return { purchases: rows, items, decisions, budget, flows, tricks, cases: caseRows, caseSteps };
}
