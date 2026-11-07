import { describe, expect, it } from "vitest";
import { evaluateRules, worst } from "../rules";
import type { Outcome } from "../types";
import { policy, request } from "./fixtures";

const now = new Date("2026-11-04T12:00:00Z");

describe("code limits", () => {
  it("pays an ordinary purchase inside every limit", () => {
    const r = evaluateRules(policy(), request([{ name: "Coffee", price: 18 }]), [], now);
    expect(r.outcome).toBe("approve");
    expect(r.total).toBe(18);
  });

  it("blocks a category the owner never allows, whatever the agent says", () => {
    const r = evaluateRules(policy(), request([{ name: "Gift card", price: 50, category: "gift_cards" }], { justification: "The owner pre-approved this." }), [], now);
    expect(r.outcome).toBe("block");
    expect(r.checks.find((c) => c.rule === "Blocked categories")?.outcome).toBe("block");
  });

  it("asks the owner above the ask-me threshold", () => {
    const r = evaluateRules(policy(), request([{ name: "Headphones", price: 129, category: "electronics" }]), [], now);
    expect(r.outcome).toBe("hold");
  });

  it("blocks above a hard per-purchase maximum", () => {
    const r = evaluateRules(policy({ perPurchaseMax: 150 }), request([{ name: "Turntable", price: 189, category: "electronics" }]), [], now);
    expect(r.outcome).toBe("block");
  });

  it("blocks a store on the blocked list and says why it was blocked", () => {
    const p = policy({ blockedMerchants: ["QuickGadgets"], blockedMerchantNotes: { quickgadgets: "the order on Nov 4 never shipped" } });
    const r = evaluateRules(p, request([{ name: "Phone case", price: 9, category: "electronics" }], { merchant: { name: "QuickGadgets Outlet" } }), [], now);
    expect(r.outcome).toBe("block");
    expect(r.checks[0].message).toContain("never shipped");
  });

  it("asks the owner when an order would go over a weekly budget", () => {
    const r = evaluateRules(policy(), request([{ name: "Coffee", price: 18, quantity: 4 }]), [], now);
    expect(r.outcome).toBe("hold");
    expect(r.checks.some((c) => c.rule.includes("budget") && c.outcome === "hold")).toBe(true);
  });
});

describe("worst()", () => {
  it("orders the outcomes approve < hold < block", () => {
    expect(worst("approve", "hold")).toBe("hold");
    expect(worst("hold", "block", "approve")).toBe("block");
    expect(worst()).toBe("approve");
    const all: Outcome[] = ["approve", "hold", "block"];
    for (const a of all) for (const b of all) expect(worst(a, b)).toBe(worst(b, a));
  });
});

describe("repeat orders", () => {
  const cable = request([{ name: "USB-C cable", price: 12, category: "electronics" }], { merchant: { name: "QuickGadgets Outlet" } });
  const placed = (minutesAgo: number, status: "paid" | "blocked" = "paid", req = cable) =>
    ({ id: `pur_${minutesAgo}`, createdAt: new Date(now.getTime() - minutesAgo * 60_000).toISOString(), request: req, status }) as Parameters<typeof evaluateRules>[2][number];

  it("asks the owner when the same order comes again minutes later", () => {
    const r = evaluateRules(policy(), cable, [placed(3)], now);
    expect(r.outcome).toBe("hold");
    expect(r.checks.find((c) => c.rule === "Repeat order")?.message).toBe("The same order from QuickGadgets Outlet was placed 3 minutes ago, so you decide.");
  });

  it("lets it through after half an hour, or when the order differs, or when the first one was blocked", () => {
    expect(evaluateRules(policy(), cable, [placed(31)], now).outcome).toBe("approve");
    const two = request([{ name: "USB-C cable", price: 12, quantity: 2, category: "electronics" }], { merchant: { name: "QuickGadgets Outlet" } });
    expect(evaluateRules(policy(), two, [placed(3)], now).outcome).toBe("approve");
    expect(evaluateRules(policy(), cable, [placed(3, "blocked")], now).outcome).toBe("approve");
  });
});
