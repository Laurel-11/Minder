// Turns the owner's plain-language rules into a structured Policy.
import { generateJson, type Schema } from "./ai";
import { CATEGORIES, type Policy } from "./types";

const categoryEnum = [...CATEGORIES] as string[];

const schema: Schema = {
  type: "OBJECT",
  properties: {
    approvalThreshold: { type: "NUMBER", description: "Purchases above this USD amount need the owner's approval." },
    perPurchaseMax: { type: "NUMBER", nullable: true, description: "Hard maximum per purchase in USD, or null if none was stated." },
    budgets: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          label: { type: "STRING", description: "Short name for the budget, e.g. 'Food'." },
          categories: { type: "ARRAY", items: { type: "STRING", enum: categoryEnum }, description: "Categories covered. Empty means all spending." },
          period: { type: "STRING", enum: ["day", "week", "month"] },
          limit: { type: "NUMBER" },
        },
        required: ["label", "categories", "period", "limit"],
      },
    },
    blockedCategories: { type: "ARRAY", items: { type: "STRING", enum: categoryEnum } },
    blockedMerchants: { type: "ARRAY", items: { type: "STRING" } },
    explanation: {
      type: "ARRAY",
      items: { type: "STRING" },
      description: "One short plain-English line per rule, written to the owner, e.g. 'Food: up to $60 every 7 days'.",
    },
  },
  required: ["approvalThreshold", "perPurchaseMax", "budgets", "blockedCategories", "blockedMerchants", "explanation"],
};

const SYSTEM = `You convert a person's spending rules for their AI shopping agent into structured JSON.
Categories: ${categoryEnum.join(", ")}.
- One budget can cover several categories. "Food" or "eating" covers groceries and food_delivery. A budget for everything uses an empty category list.
- "Weekly" means period "week", "daily" means "day", "monthly" means "month".
- If no approval threshold is stated, use 100.
- Only set perPurchaseMax if the person states an absolute maximum.
- Do not invent rules the person did not state (apart from the default threshold).
- The rules may be written in any language; always write the explanation lines in English.`;

export async function parseRules(text: string): Promise<{ policy: Policy; model: string }> {
  const { data, model } = await generateJson<Omit<Policy, "currency">>({
    system: SYSTEM,
    prompt: `Rules:\n"""${text}"""`,
    schema,
    replay: { key: `rules|${text}`, label: `Rules: "${text.trim().slice(0, 60)}"` },
  });
  const policy: Policy = {
    currency: "USD",
    approvalThreshold: Number(data.approvalThreshold) || 100,
    perPurchaseMax: data.perPurchaseMax ?? null,
    budgets: (data.budgets ?? []).filter((b) => b.limit > 0),
    blockedCategories: data.blockedCategories ?? [],
    blockedMerchants: (data.blockedMerchants ?? []).filter(Boolean),
    explanation: data.explanation ?? [],
  };
  return { policy, model };
}
