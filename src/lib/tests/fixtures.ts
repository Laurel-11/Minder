import { DEMO_POLICY, freshDb } from "../seed";
import type { Category, Policy, Purchase, PurchaseRequest } from "../types";

export const policy = (over: Partial<Policy> = {}): Policy => ({ ...structuredClone(DEMO_POLICY), ...over });

export function request(items: { name: string; price: number; quantity?: number; category?: Category }[], over: Partial<PurchaseRequest> = {}): PurchaseRequest {
  return {
    agent: "ShopBot",
    ownerInstruction: "Buy me a bag of coffee beans.",
    merchant: { name: "Bean & Leaf Market" },
    currency: "USD",
    items: items.map((i) => ({ name: i.name, unitPrice: i.price, quantity: i.quantity ?? 1, category: i.category ?? "groceries" })),
    justification: "As asked.",
    pageExcerpt: "Coffee beans. $18.",
    ...over,
  };
}

/** The sample story that ships with the demo: real purchases and cases from a self-test run. */
export const storyDb = () => freshDb({ story: true });
export const story = (): Purchase[] => storyDb().purchases;
