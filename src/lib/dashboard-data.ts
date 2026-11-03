// Flattens Chaperone's purchase log into the two tables the AG Studio dashboard reads.
import type { Outcome, Purchase, PurchaseStatus } from "./types";

const STATUS_LABEL: Record<PurchaseStatus, string> = {
  paid: "Approved",
  approved_by_owner: "Approved by you",
  awaiting_owner: "Waiting for you",
  declined_by_owner: "Declined by you",
  blocked: "Blocked",
  payment_failed: "Payment failed",
};
const DECISION_LABEL: Record<Outcome, string> = { approve: "Approved", hold: "Asked you", block: "Blocked" };
const moneyMoved = (s: PurchaseStatus) => s === "paid" || s === "approved_by_owner";
const keptSafe = (s: PurchaseStatus) => s === "blocked" || s === "declined_by_owner";

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
  spent: number;
  keptSafe: number;
  aiVerdict: string;
  manipulation: string;
  reason: string;
};

/** One row per verdict, always in this order, so chart colours stay green / amber / red. */
export type DecisionRow = { decision: string; purchases: number; amount: number };

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

export function buildDashboardRows(purchases: Purchase[]): { purchases: PurchaseRow[]; items: ItemRow[]; decisions: DecisionRow[] } {
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
    spent: moneyMoved(p.status) ? p.total : 0,
    keptSafe: keptSafe(p.status) ? p.total : 0,
    aiVerdict: p.ai ? DECISION_LABEL[p.ai.verdict] : "Not run",
    manipulation: p.ai?.manipulationSuspected ? "Suspected" : "None found",
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
  return { purchases: rows, items, decisions };
}
