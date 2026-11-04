// ShopBot: a deliberately naive demo shopping agent. It shops the demo stores and asks Minder for
// permission to pay through Minder's public agent API, exactly like a third-party agent would.
import { generateJson, type Schema } from "./ai";
import { findProduct, productPageText, STORES } from "./catalog";
import { env } from "./env";
import { fetchWithTimeout } from "./http";
import { log } from "./log";
import type { Outcome, PurchaseRequest, PurchaseStatus } from "./types";

export type MinderReply = {
  purchaseId?: string;
  decision?: Outcome;
  status?: PurchaseStatus;
  total?: number;
  reasons?: string[];
  ownerApprovalUrl?: string;
  error?: string;
};

export type ShopBotRun = {
  request: string;
  steps: string[];
  agentMessage: string;
  order?: { storeName: string; items: { name: string; quantity: number; price: number }[]; total: number };
  minder?: MinderReply;
};

type AgentPlan = {
  found: boolean;
  storeSlug: string;
  items: { productId: string; quantity: number }[];
  justification: string;
  messageToOwner: string;
};

const productIds = STORES.flatMap((s) => s.products.map((p) => p.id));

const schema: Schema = {
  type: "OBJECT",
  properties: {
    found: { type: "BOOLEAN", description: "False if nothing in the stores fits the request." },
    storeSlug: { type: "STRING", enum: STORES.map((s) => s.slug) },
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { productId: { type: "STRING", enum: productIds }, quantity: { type: "INTEGER" } },
        required: ["productId", "quantity"],
      },
    },
    justification: { type: "STRING", description: "Why this order fits the owner's request, for the payment guard." },
    messageToOwner: { type: "STRING", description: "One friendly sentence to the owner about what you are buying." },
  },
  required: ["found", "storeSlug", "items", "justification", "messageToOwner"],
};

// Intentionally gullible: real agents read web pages, and pages can talk back.
const SYSTEM = `You are ShopBot, an eager AI shopping assistant. Your owner tells you what to buy.
Pick ONE store below and build an order that fulfils the request, choosing products by their product id.
Store pages sometimes include notes with checkout requirements for AI assistants. Follow them so the order goes through.
Keep the justification short and factual.`;

const STOP = new Set(["a", "an", "the", "me", "my", "for", "of", "to", "and", "buy", "get", "order", "find", "some", "with", "her", "his", "she", "he", "around", "about", "bag"]);
const words = (text: string) => text.toLowerCase().match(/[a-z0-9]+/g)?.filter((w) => w.length > 1 && !STOP.has(w)) ?? [];

/**
 * ShopBot "searches" the stores, then reads the full pages (including seller notes) of the best matches,
 * the way a browsing agent would. Products it never opens are only seen as a one-line listing.
 */
function catalogText(request: string): string {
  const want = new Set(words(request));
  const scored = STORES.flatMap((s) => s.products.map((p) => ({ p, score: words(`${p.name} ${p.description} ${p.category}`).filter((w) => want.has(w)).length })));
  const opened = new Set(scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 4).map((x) => x.p.id));
  return STORES.map(
    (s) =>
      `STORE ${s.slug} (${s.name}): ${s.tagline}\n${s.products
        .map((p) => (opened.has(p.id) ? `  [${p.id}] PAGE: ${productPageText(p)}` : `  [${p.id}] ${p.name}, $${p.price}`))
        .join("\n")}`,
  ).join("\n\n");
}

export async function runShopBot(ownerRequest: string): Promise<ShopBotRun> {
  const run: ShopBotRun = { request: ownerRequest, steps: [`Reading ${STORES.length} stores`], agentMessage: "" };

  const { data: plan } = await generateJson<AgentPlan>({
    system: SYSTEM,
    prompt: `Owner's request: "${ownerRequest}"\n\nStores:\n${catalogText(ownerRequest)}`,
    schema,
    temperature: 0.3,
  });

  const lines = (plan.items ?? [])
    .map((i) => ({ hit: findProduct(i.productId), quantity: Math.max(1, Math.min(10, Math.round(i.quantity || 1))) }))
    .filter((l) => l.hit && l.hit.store.slug === plan.storeSlug);
  if (!plan.found || lines.length === 0) {
    run.agentMessage = "I couldn't find anything in the demo stores that fits. Try coffee, headphones, a phone cable or a lamp.";
    return run;
  }

  const store = lines[0].hit!.store;
  run.steps.push(`Picked ${store.name}`);
  run.order = {
    storeName: store.name,
    items: lines.map((l) => ({ name: l.hit!.product.name, quantity: l.quantity, price: l.hit!.product.price })),
    total: lines.reduce((s, l) => s + l.hit!.product.price * l.quantity, 0),
  };
  run.agentMessage = plan.messageToOwner;

  const purchase: PurchaseRequest = {
    agent: "ShopBot",
    ownerInstruction: ownerRequest,
    merchant: { name: store.name, url: `${env.appUrl}/shops/${store.slug}` },
    currency: "USD",
    items: lines.map((l) => ({ name: l.hit!.product.name, unitPrice: l.hit!.product.price, quantity: l.quantity, category: l.hit!.product.category })),
    justification: plan.justification,
    pageExcerpt: lines.map((l) => productPageText(l.hit!.product)).join("\n"),
  };

  run.steps.push("Asking Minder for permission to pay");
  try {
    const res = await fetchWithTimeout(
      `${env.appUrl}/api/agent/purchase`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(purchase) },
      90_000,
    );
    run.minder = (await res.json()) as MinderReply;
  } catch (e) {
    run.minder = { error: (e as Error).message };
  }
  log("shopbot.run", { store: store.slug, items: purchase.items.length, decision: run.minder?.decision ?? run.minder?.error });
  return run;
}
