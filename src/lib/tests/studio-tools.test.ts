import { describe, expect, it } from "vitest";
import { findPurchases, simulateRules } from "../studio-tools";
import { storyDb } from "./fixtures";

describe("the rules advisor's what-if replay", () => {
  it("shows which past purchases a tighter food budget would have stopped", () => {
    const w = simulateRules(storyDb(), { budgetLimit: 15 });
    expect(w.changes[0]).toContain("$15.00");
    expect(w.rows.filter((r) => r.changed).map((r) => r.store)).toContain("Bean & Leaf Market");
  });

  it("shows held purchases that a higher ask-me limit would have paid", () => {
    const w = simulateRules(storyDb(), { approvalThreshold: 200 });
    const changed = w.rows.filter((r) => r.changed);
    expect(changed.length).toBeGreaterThan(0);
    expect(changed.every((r) => r.before === "Asked you" && r.after === "Approved")).toBe(true);
  });

  it("never changes the owner's real rules", () => {
    const db = storyDb();
    const before = JSON.stringify(db.policy);
    simulateRules(db, { approvalThreshold: 1, blockStores: ["Bean & Leaf"] });
    expect(JSON.stringify(db.policy)).toBe(before);
  });

  it("refuses a what-if with nothing to change", () => {
    expect(() => simulateRules(storyDb(), {})).toThrow(/No rule change/);
  });
});

describe("the auditor's purchase lookup", () => {
  it("finds a purchase by its exact id", () => {
    const db = storyDb();
    const id = db.purchases[0].id;
    expect(findPurchases(db, id).map((m) => m.purchaseId)).toEqual([id]);
  });
  it("finds purchases by store name", () => {
    const found = findPurchases(storyDb(), "QuickGadgets");
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((m) => m.store.includes("QuickGadgets"))).toBe(true);
  });
});
