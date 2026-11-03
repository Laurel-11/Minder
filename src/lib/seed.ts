// The demo's starting data, with no I/O: Maya's rules, and a sample story recorded from a real self-test run
// (real sandbox orders, holds, a refund and a dispute), so a fresh copy of the site is never empty.
import story from "./demo-story.json";
import type { Db, Policy, Purchase, RecoveryCase, VaultInfo } from "./types";

export const DEMO_RULES_TEXT =
  "Groceries and food delivery: no more than $60 a week. Ask me before anything over $100. Never buy gift cards.";

/** What the rules translator produces for DEMO_RULES_TEXT, saved so a reset needs no AI call. */
export const DEMO_POLICY: Policy = {
  currency: "USD",
  approvalThreshold: 100,
  perPurchaseMax: null,
  budgets: [{ label: "Groceries and food delivery", categories: ["groceries", "food_delivery"], period: "week", limit: 60 }],
  blockedCategories: ["gift_cards"],
  blockedMerchants: [],
  explanation: ["Groceries and food delivery: up to $60 per week.", "Ask for approval for any purchase over $100.", "Gift cards are blocked."],
};

type Story = { recordedAt?: string; demoClockDays: number; purchases: Purchase[]; cases: RecoveryCase[] };
const STORY = story as unknown as Story;

/** A fresh database with the demo rules, and the sample story when `story` is true. */
export function freshDb(opts: { story: boolean; vault?: VaultInfo }): Db {
  const withStory = opts.story && STORY.purchases.length > 0;
  return {
    version: 1,
    owner: { name: "Maya" },
    vault: opts.vault,
    rulesText: DEMO_RULES_TEXT,
    policy: structuredClone(DEMO_POLICY),
    purchases: withStory ? structuredClone(STORY.purchases) : [],
    cases: withStory ? structuredClone(STORY.cases) : [],
    demoClockDays: withStory ? STORY.demoClockDays : 0,
    pendingSetupTokens: [],
  };
}
