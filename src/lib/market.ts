// What the rest of the market charges. Before paying, Minder looks each item up in Channel3's catalog of products from
// thousands of real retailers. Code turns the offers into a typical price, and an item that costs far more than other
// stores charge waits for the owner. The AI review sees the same prices as trusted context next to the untrusted store page.
import { env } from "./env";
import { fetchWithTimeout } from "./http";
import { log } from "./log";
import { usd } from "./money";
import type { ItemMarket, LineItem, MarketCheck, MarketOffer, PurchaseRequest, RuleCheck } from "./types";

export type { ItemMarket, MarketCheck, MarketOffer };

const SEARCH = "https://api.trychannel3.com/v1/search";
/**
 * An item priced above this multiple of the typical price elsewhere waits for the owner. Set for plain gouging only:
 * catalog matches for a generic name span cheap and premium models, and subtler overcharges are the AI review's job.
 */
export const OVERPRICE_FACTOR = 3;
/** Fewer comparable offers than this is not a market price. */
const MIN_OFFERS = 3;


type C3Product = { title?: string; offers?: { url?: string; domain?: string; price?: { price?: number; currency?: string }; availability?: string }[] };

const STOP = new Set(["the", "a", "an", "and", "or", "for", "with", "of", "to", "in", "on", "by", "per", "pack", "set", "new"]);
const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOP.has(w)),
  );

/** How much of the item's own name a catalog title covers, 0 to 1. A different product scores low. */
export function relevance(item: string, title: string): number {
  const a = words(item);
  if (a.size === 0) return 0;
  const b = words(title);
  return [...a].filter((w) => b.has(w) || b.has(`${w}s`) || (w.endsWith("s") && b.has(w.slice(0, -1)))).length / a.size;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return Math.round((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) * 100) / 100;
};

/** Turn Channel3 products into the market for one item: matching products only, US dollar offers in stock. */
export function summarize(item: LineItem, products: C3Product[]): ItemMarket {
  const offers: MarketOffer[] = products
    // Most of the item's own words must be in the title: "Oat Milk Foundation" is make-up, not barista oat milk.
    .filter((p) => p.title && relevance(item.name, p.title) >= 0.7)
    .flatMap((p) =>
      (p.offers ?? [])
        .filter((o) => o.price?.currency === "USD" && typeof o.price.price === "number" && o.price.price > 0 && o.availability !== "OutOfStock")
        .map((o) => ({ title: p.title!, store: o.domain ?? "", price: o.price!.price!, url: o.url ?? "" })),
    )
    .sort((a, b) => a.price - b.price);
  return {
    item: item.name,
    unitPrice: item.unitPrice,
    offers: offers.slice(0, 8),
    typical: offers.length >= MIN_OFFERS ? median(offers.map((o) => o.price)) : null,
    lowest: offers[0] ?? null,
    highest: offers.at(-1)?.price ?? null,
    stores: new Set(offers.map((o) => o.store)).size,
  };
}

const cache = new Map<string, { at: number; products: C3Product[] }>();
const HOUR = 3_600_000;

async function search(query: string): Promise<C3Product[]> {
  const hit = cache.get(query);
  if (hit && Date.now() - hit.at < HOUR) return hit.products;
  const res = await fetchWithTimeout(
    SEARCH,
    {
      method: "POST",
      headers: { "x-api-key": env.channel3ApiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ query, limit: 8, filters: { conditions: ["new"], availability: ["InStock"] }, config: { country: "US", currency: "USD" } }),
    },
    8_000,
  );
  if (!res.ok) throw new Error(`Channel3 answered ${res.status}`);
  const products = ((await res.json()) as { products?: C3Product[] }).products ?? [];
  cache.set(query, { at: Date.now(), products });
  return products;
}

export const marketEnabled = () => Boolean(env.channel3ApiKey);

/** Look every item up (at most 4). Returns null when Channel3 is not set up or did not answer: the check then simply does not run. */
export async function checkMarket(request: PurchaseRequest): Promise<MarketCheck | null> {
  if (!marketEnabled()) return null;
  try {
    const items = await Promise.all(request.items.slice(0, 4).map(async (i) => summarize(i, await search(i.name))));
    log("market.checked", { items: items.length, priced: items.filter((i) => i.typical !== null).length });
    return { source: "Channel3", checkedAt: new Date().toISOString(), items };
  } catch (e) {
    log("market.failed", { error: (e as Error).message });
    return null;
  }
}

/** The code check: an item that costs far more than other stores charge for it waits for the owner. */
export function marketRule(m: MarketCheck | null): RuleCheck | null {
  if (!m) return null;
  const priced = m.items.filter((i) => i.typical !== null);
  if (!priced.length) return null;
  const over = priced.find((i) => i.unitPrice > i.typical! * OVERPRICE_FACTOR);
  if (over)
    return {
      rule: "Market price",
      outcome: "hold",
      message: `${over.item} costs ${usd(over.unitPrice)} here; ${over.stores} other store${over.stores === 1 ? "" : "s"} sell it for about ${usd(over.typical!)}, so you decide.`,
    };
  const first = priced[0];
  return {
    rule: "Market price",
    outcome: "approve",
    message: `${first.item} is ${usd(first.unitPrice)} here. ${rangeWords(first)}.`,
  };
}

/** "Similar products sell for $29.00 to $429.95 at 5 stores": a range, because a generic name matches cheap and premium models. */
export const rangeWords = (i: ItemMarket) =>
  i.lowest && i.highest !== null && i.highest > i.lowest.price
    ? `Similar products sell for ${usd(i.lowest.price)} to ${usd(i.highest)} at ${i.stores} store${i.stores === 1 ? "" : "s"}`
    : i.lowest
      ? `Similar products sell for ${usd(i.lowest.price)} at ${i.stores} store${i.stores === 1 ? "" : "s"}`
      : "No comparable products found";

/** The same prices for the AI review, as trusted context: they come from Channel3, not from the store. */
export function marketForReview(m: MarketCheck | null): string {
  if (!m) return "";
  const lines = m.items.map((i) =>
    i.typical === null
      ? `- ${i.item}: no comparable products found`
      : `- ${i.item}: ${rangeWords(i)} (median ${usd(i.typical)}). Matching products: ${[...new Set(i.offers.map((o) => o.title))].slice(0, 3).join("; ")}`,
  );
  return `<market_prices source="Channel3 product catalog, trusted">\n${lines.join("\n")}\n</market_prices>`;
}
