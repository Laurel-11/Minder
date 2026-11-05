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
