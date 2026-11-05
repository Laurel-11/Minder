import { describe, expect, it } from "vitest";
import { buildDashboardRows, withAndWithout } from "../dashboard-data";
import { storyDb } from "./fixtures";

const db = storyDb();
const rows = buildDashboardRows(db.purchases, { policy: db.policy, cases: db.cases });
const total = (xs: { amount: number }[]) => Math.round(xs.reduce((s, x) => s + x.amount, 0) * 100) / 100;

describe("the dashboard's tables, built from the sample story", () => {
  it("accounts for every dollar ShopBot asked to spend in the money flow", () => {
    expect(total(rows.flows)).toBeCloseTo(total(rows.purchases), 2);
  });

  it("splits a partly refunded purchase so the refund flows back to the owner", () => {
    const refunded = rows.flows.filter((f) => f.whereNow === "Refunded to you");
    const cases = db.cases.filter((c) => c.status === "refunded");
    expect(total(refunded)).toBeCloseTo(cases.reduce((s, c) => s + (c.refund?.amount ?? 0), 0), 2);
  });

  it("lists one store trick per purchase the AI review caught being steered", () => {
    expect(rows.tricks.length).toBe(db.purchases.filter((p) => p.ai?.manipulationSuspected).length);
    expect(rows.tricks.every((t) => t.quote.length > 0)).toBe(true);
  });

  it("ties every step of a recovery case back to its case and purchase", () => {
    for (const s of rows.caseSteps) {
      expect(db.cases.some((c) => c.id === s.caseId && c.purchaseId === s.purchaseId)).toBe(true);
    }
  });
});

describe("with and without Minder", () => {
  const ww = withAndWithout(db.purchases, db.cases);
  it("never paid a store that tricked the agent", () => {
    expect(ww.tricked).toBeGreaterThan(0);
    expect(ww.trickedPaid).toBe(0);
  });
  it("spent less than an unguarded agent would have", () => {
    expect(ww.withMinder).toBeLessThan(ww.withoutMinder);
    expect(ww.withMinder).toBeCloseTo(rows.purchases.reduce((s, p) => s + p.spent, 0), 2);
  });
});
