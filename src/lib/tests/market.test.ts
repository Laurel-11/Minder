// The market price check: only matching products count, too few offers is no market, and only plain gouging waits for the owner.
import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "../env";
import { checkMarket, marketForReview, marketRule, relevance, summarize } from "../market";
import { request } from "./fixtures";

const product = (title: string, ...prices: number[]) => ({
  title,
  offers: prices.map((price, i) => ({ url: `https://shop${i}.example/p`, domain: `shop${i}.example`, price: { price, currency: "USD" }, availability: "InStock" })),
});
const beans = { name: "Medium roast whole beans, 1 kg", unitPrice: 18, quantity: 1, category: "groceries" as const };

describe("relevance", () => {
  it("scores a catalog title by how much of the item's own name it covers", () => {
    expect(relevance("Medium roast whole beans, 1 kg", "Lavazza Medium Roast Whole Bean Coffee 1kg")).toBeGreaterThanOrEqual(0.5);
    expect(relevance("Medium roast whole beans, 1 kg", "Bluetooth speaker, waterproof")).toBe(0);
  });
});

describe("summarize", () => {
  it("keeps only matching products, in-stock US dollar offers, cheapest first, and takes the median", () => {
    const m = summarize(beans, [
      product("Medium Roast Whole Bean Coffee, 1 kg", 22, 16),
      product("Whole bean medium roast coffee, 1 kg", 30),
      product("Portable Bluetooth speaker", 5),
      { title: "Medium roast beans", offers: [{ url: "u", domain: "eu.example", price: { price: 1, currency: "EUR" } }] },
    ]);
    expect(m.offers.map((o) => o.price)).toEqual([16, 22, 30]);
    expect(m.typical).toBe(22);
    expect(m.lowest?.store).toBe("shop1.example");
    expect(m.stores).toBe(2);
  });

  it("calls fewer than three offers no market price", () => {
    expect(summarize(beans, [product("Medium roast whole beans, 1 kg", 20, 21)]).typical).toBeNull();
  });

  it("leaves out a product that shares only some words, like make-up called oat milk", () => {
    const milk = { name: "Barista oat milk, 6-pack", unitPrice: 14, quantity: 1, category: "groceries" as const };
    expect(summarize(milk, [product("Oat Milk Foundation", 44, 44, 44)]).offers).toEqual([]);
  });
});

describe("marketRule", () => {
  const check = (unitPrice: number, typical: number | null) => ({
    source: "Channel3" as const,
    checkedAt: "",
    items: [{ item: "Desk lamp", unitPrice, offers: [], typical, lowest: typical ? { title: "Lamp", store: "lamps.example", price: typical - 5, url: "" } : null, highest: typical ? typical + 40 : null, stores: 6 }],
  });
  it("holds plain gouging for the owner", () => {
    expect(marketRule(check(120, 30))).toMatchObject({ rule: "Market price", outcome: "hold", message: "Desk lamp costs $120.00 here; 6 other stores sell it for about $30.00, so you decide." });
  });
  it("passes a price in line with the market, and says where it is cheapest", () => {
    expect(marketRule(check(30, 34))).toMatchObject({ outcome: "approve", message: "Desk lamp is $30.00 here. Similar products sell for $29.00 to $74.00 at 6 stores." });
  });
  it("adds nothing when there is no market data", () => {
    expect(marketRule(null)).toBeNull();
    expect(marketRule(check(30, null))).toBeNull();
  });
  it("hands the AI review the same prices, marked as trusted", () => {
    expect(marketForReview(check(30, 34))).toContain('source="Channel3 product catalog, trusted"');
  });
});

describe("checkMarket", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    env.channel3ApiKey = "";
  });
  it("does not run without a Channel3 key", async () => {
    env.channel3ApiKey = "";
    expect(await checkMarket(request([{ name: "Coffee", price: 18 }]))).toBeNull();
  });
  it("asks Channel3 for each item with the key in a header, never in the URL", async () => {
    env.channel3ApiKey = "test-channel3-key";
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ products: [product("Medium roast coffee beans", 17, 19, 21)] }), { status: 200 });
    });
    const m = await checkMarket(request([{ name: "Medium roast coffee beans", price: 18 }]));
    expect(calls[0].url).toBe("https://api.trychannel3.com/v1/search");
    expect((calls[0].init.headers as Record<string, string>)["x-api-key"]).toBe("test-channel3-key");
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ query: "Medium roast coffee beans", config: { country: "US", currency: "USD" } });
    expect(m?.items[0].typical).toBe(19);
  });
  it("lets the purchase go on without market prices when Channel3 fails", async () => {
    env.channel3ApiKey = "test-channel3-key";
    vi.stubGlobal("fetch", async () => new Response("busy", { status: 503 }));
    expect(await checkMarket(request([{ name: "Something else entirely", price: 18 }]))).toBeNull();
  });
});
