// Hard spending rules, enforced by plain code. The AI can never loosen these; only the owner can.
import type { Category, Outcome, Period, Policy, Purchase, PurchaseRequest, RuleCheck } from "./types";
import { usd } from "./money";

const SEVERITY: Record<Outcome, number> = { approve: 0, hold: 1, block: 2 };
export const worst = (...outcomes: Outcome[]): Outcome =>
  outcomes.reduce<Outcome>((a, b) => (SEVERITY[b] > SEVERITY[a] ? b : a), "approve");

const PERIOD_DAYS: Record<Period, number> = { day: 1, week: 7, month: 30 };
const PERIOD_LABEL: Record<Period, string> = { day: "24 hours", week: "7 days", month: "30 days" };
export const categoryLabel = (c: Category) => c.replace("_", " ");

/** Purchases that count against a budget (money spent or currently held). */
const COUNTED = new Set(["paid", "awaiting_owner", "approved_by_owner"]);

export function itemsTotal(req: PurchaseRequest): number {
  return req.items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
}

/** The blocked-list entry that matches this store, if any. */
export function findBlockedMerchant(policy: Policy, storeName: string): string | undefined {
  const name = storeName.trim().toLowerCase();
  return policy.blockedMerchants.find((m) => m.trim() !== "" && name.includes(m.trim().toLowerCase()));
}

/** How long an identical order counts as a repeat: long enough to catch an agent retrying or looping. */
export const REPEAT_WINDOW_MINUTES = 30;

/** Same store, same items and quantities: what an agent stuck in a retry loop sends again. */
const sameOrder = (a: PurchaseRequest, b: PurchaseRequest) => {
  const key = (r: PurchaseRequest) =>
    [r.merchant.name.trim().toLowerCase(), ...r.items.map((i) => `${i.name.trim().toLowerCase()}|${i.quantity}|${i.unitPrice}`).sort()].join("\n");
  return key(a) === key(b);
};

export function evaluateRules(policy: Policy, req: PurchaseRequest, history: Purchase[], now = new Date()) {
  const checks: RuleCheck[] = [];
  const total = itemsTotal(req);
  const blockedMerchant = findBlockedMerchant(policy, req.merchant.name);
  const blockNote = blockedMerchant ? policy.blockedMerchantNotes?.[blockedMerchant.trim().toLowerCase()] : undefined;
  checks.push(
    blockedMerchant
      ? {
          rule: "Blocked merchants",
          outcome: "block",
          message: `${req.merchant.name} is on your blocked list${blockNote ? `. You blocked it after ${blockNote}` : ""}.`,
        }
      : { rule: "Blocked merchants", outcome: "approve", message: `${req.merchant.name} is not blocked.` },
  );

  const blockedItems = req.items.filter((i) => policy.blockedCategories.includes(i.category));
  checks.push(
    blockedItems.length
      ? {
          rule: "Blocked categories",
          outcome: "block",
          message: `You never allow ${categoryLabel(blockedItems[0].category)} (${blockedItems.map((i) => i.name).join(", ")}).`,
        }
      : { rule: "Blocked categories", outcome: "approve", message: "No blocked categories in this order." },
  );

  if (policy.perPurchaseMax !== null && total > policy.perPurchaseMax) {
    checks.push({ rule: "Maximum per purchase", outcome: "block", message: `${usd(total)} is over your hard limit of ${usd(policy.perPurchaseMax)}.` });
  }

  checks.push(
    total > policy.approvalThreshold
      ? { rule: "Ask me first", outcome: "hold", message: `${usd(total)} is over ${usd(policy.approvalThreshold)}, so you decide.` }
      : { rule: "Ask me first", outcome: "approve", message: `${usd(total)} is under your ${usd(policy.approvalThreshold)} ask-me threshold.` },
  );

  // A repeat of an order placed minutes ago is how a retrying or looping agent buys five of everything.
  const repeat = history.find(
    (p) => COUNTED.has(p.status) && now.getTime() - new Date(p.createdAt).getTime() < REPEAT_WINDOW_MINUTES * 60_000 && sameOrder(p.request, req),
  );
  if (repeat) {
    const minutes = Math.max(1, Math.round((now.getTime() - new Date(repeat.createdAt).getTime()) / 60_000));
    checks.push({ rule: "Repeat order", outcome: "hold", message: `The same order from ${req.merchant.name} was placed ${minutes} minute${minutes === 1 ? "" : "s"} ago, so you decide.` });
  }

  for (const budget of policy.budgets) {
    const inScope = (c: Category) => budget.categories.length === 0 || budget.categories.includes(c);
    const thisOrder = req.items.filter((i) => inScope(i.category)).reduce((s, i) => s + i.unitPrice * i.quantity, 0);
    if (thisOrder === 0) continue;
    const since = now.getTime() - PERIOD_DAYS[budget.period] * 86_400_000;
    const spent = history
      .filter((p) => COUNTED.has(p.status) && new Date(p.createdAt).getTime() >= since)
      .flatMap((p) => p.request.items)
      .filter((i) => inScope(i.category))
      .reduce((s, i) => s + i.unitPrice * i.quantity, 0);
    const left = budget.limit - spent;
    const label = `${budget.label} budget (${usd(budget.limit)} / ${PERIOD_LABEL[budget.period]})`;
    checks.push(
      thisOrder > left
        ? { rule: label, outcome: "hold", message: `This needs ${usd(thisOrder)} but only ${usd(Math.max(left, 0))} is left, so you decide.` }
        : { rule: label, outcome: "approve", message: `${usd(thisOrder)} fits; ${usd(left - thisOrder)} will be left.` },
    );
  }

  return { outcome: worst(...checks.map((c) => c.outcome)), checks, total };
}
