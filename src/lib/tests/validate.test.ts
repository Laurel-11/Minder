// What any agent (including one over MCP or the REST API) must send before Minder will even look at a purchase.
import { describe, expect, it } from "vitest";
import { parsePurchaseRequest } from "../validate";

const good = {
  agent: "ShopBot",
  ownerInstruction: "Buy me a USB-C charging cable.",
  merchant: { name: "QuickGadgets Outlet" },
  items: [{ name: "USB-C to USB-C charging cable, 2 m", unitPrice: 12, quantity: 1, category: "electronics" }],
  justification: "As asked.",
};

describe("parsePurchaseRequest", () => {
  it("accepts a well-formed request and cleans it", () => {
    const r = parsePurchaseRequest({ ...good, ownerInstruction: "  Buy me a cable.  ", items: [{ name: " Cable ", unitPrice: 12.345, quantity: 2, category: "electronics" }] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.ownerInstruction).toBe("Buy me a cable.");
    expect(r.value.items[0]).toEqual({ name: "Cable", unitPrice: 12.35, quantity: 2, category: "electronics" });
    expect(r.value.currency).toBe("USD");
  });
  it("names an unnamed agent and files an unknown category under other", () => {
    const r = parsePurchaseRequest({ ...good, agent: "", items: [{ name: "Thing", unitPrice: 5, category: "spaceships" }] });
    expect(r.ok && r.value.agent).toBe("Unnamed agent");
    expect(r.ok && r.value.items[0].category).toBe("other");
    expect(r.ok && r.value.items[0].quantity).toBe(1);
  });
  it("refuses a request without the owner's own words or a merchant", () => {
    expect(parsePurchaseRequest({ ...good, ownerInstruction: "" })).toMatchObject({ ok: false, error: expect.stringContaining("ownerInstruction") });
    expect(parsePurchaseRequest({ ...good, merchant: {} })).toMatchObject({ ok: false, error: expect.stringContaining("merchant.name") });
    expect(parsePurchaseRequest(null).ok).toBe(false);
  });
  it("needs 1 to 20 items, each with a name", () => {
    expect(parsePurchaseRequest({ ...good, items: [] }).ok).toBe(false);
    expect(parsePurchaseRequest({ ...good, items: Array.from({ length: 21 }, () => good.items[0]) }).ok).toBe(false);
    expect(parsePurchaseRequest({ ...good, items: [{ unitPrice: 5 }] }).ok).toBe(false);
  });
  it("refuses zero, negative or absurd prices", () => {
    for (const unitPrice of [0, -5, 10_000, "abc"]) expect(parsePurchaseRequest({ ...good, items: [{ name: "Cable", unitPrice }] }).ok).toBe(false);
  });
  it("refuses fractional, zero or huge quantities", () => {
    for (const quantity of [0, 1.5, 101]) expect(parsePurchaseRequest({ ...good, items: [{ name: "Cable", unitPrice: 12, quantity }] }).ok).toBe(false);
  });
  it("cuts over-long text instead of storing it whole", () => {
    const r = parsePurchaseRequest({ ...good, pageExcerpt: "x".repeat(10_000), justification: "y".repeat(5_000) });
    expect(r.ok && r.value.pageExcerpt?.length).toBe(4000);
    expect(r.ok && r.value.justification.length).toBe(1000);
  });
});
