import { CATEGORIES, type Category, type PurchaseRequest } from "./types";

const isCategory = (c: unknown): c is Category => typeof c === "string" && (CATEGORIES as readonly string[]).includes(c);
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Validate an agent's purchase request. Returns the clean request or an error message. */
export function parsePurchaseRequest(body: unknown): { ok: true; value: PurchaseRequest } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const merchant = (b.merchant ?? {}) as Record<string, unknown>;
  const items = Array.isArray(b.items) ? b.items : [];
  const req: PurchaseRequest = {
    agent: str(b.agent, 80) || "Unnamed agent",
    ownerInstruction: str(b.ownerInstruction, 1000),
    merchant: { name: str(merchant.name, 120), url: str(merchant.url, 300) || undefined },
    currency: "USD",
    justification: str(b.justification, 1000),
    pageExcerpt: str(b.pageExcerpt, 4000) || undefined,
    items: [],
  };
  if (!req.ownerInstruction) return { ok: false, error: "ownerInstruction is required: what did the owner ask for?" };
  if (!req.merchant.name) return { ok: false, error: "merchant.name is required." };
  if (items.length === 0 || items.length > 20) return { ok: false, error: "items must contain 1 to 20 entries." };
  for (const raw of items) {
    const i = (raw ?? {}) as Record<string, unknown>;
    const unitPrice = Number(i.unitPrice);
    const quantity = Number(i.quantity ?? 1);
    if (!str(i.name, 200)) return { ok: false, error: "Every item needs a name." };
    if (!(unitPrice > 0 && unitPrice < 10_000)) return { ok: false, error: `Item "${i.name}" has an invalid unitPrice.` };
    if (!(Number.isInteger(quantity) && quantity >= 1 && quantity <= 100)) return { ok: false, error: `Item "${i.name}" has an invalid quantity.` };
    req.items.push({ name: str(i.name, 200), unitPrice: Math.round(unitPrice * 100) / 100, quantity, category: isCategory(i.category) ? i.category : "other" });
  }
  return { ok: true, value: req };
}
