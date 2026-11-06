// After the money moves: shipping, arrival, lateness, and what each demo store says when something goes wrong.
import { describe, expect, it } from "vitest";
import { addDays, demoNow } from "../clock";
import { deliveryNow, isLate, shipAfterPayment } from "../delivery";
import { merchantReply } from "../merchant-bots";
import type { Delivery, Purchase } from "../types";

const purchase = (store: string, total: number) =>
  ({ id: "pur_1", total, request: { merchant: { name: store } }, paypal: {} }) as unknown as Purchase;

describe("shipping", () => {
  const now = new Date("2026-11-05T12:00:00Z");
  it("a store that never ships leaves the order waiting, promised in two days", async () => {
    const d = await shipAfterPayment(purchase("QuickGadgets Outlet", 9), now);
    expect(d).toEqual({ state: "awaiting_shipment", promisedBy: "2026-11-07T12:00:00.000Z" });
  });
  it("a reliable store ships at once with a USPS tracking number", async () => {
    const d = await shipAfterPayment(purchase("SoundHouse", 129), now);
    expect(d.state).toBe("shipped");
    expect(d.carrier).toBe("USPS");
    expect(d.trackingNumber).toMatch(/^9400\d{16}$/);
    expect(d.arrivesDamaged).toBe(false);
  });
  it("the damaged-goods store ships too, but the parcel arrives damaged", async () => {
    expect((await shipAfterPayment(purchase("BrightHome", 30), now)).arrivesDamaged).toBe(true);
  });
});

describe("arrival and lateness", () => {
  const shipped: Delivery = { state: "shipped", promisedBy: "2026-11-07T00:00:00Z", shippedAt: "2026-11-05T00:00:00Z" };
  it("a parcel arrives two days after it ships", () => {
    expect(deliveryNow(shipped, new Date("2026-11-06T23:00:00Z")).state).toBe("shipped");
    expect(deliveryNow(shipped, new Date("2026-11-07T00:00:00Z")).state).toBe("delivered");
  });
  it("an order is late only when it never shipped and the promised date has passed", () => {
    const waiting: Delivery = { state: "awaiting_shipment", promisedBy: "2026-11-07T00:00:00Z" };
    expect(isLate(waiting, new Date("2026-11-06T00:00:00Z"))).toBe(false);
    expect(isLate(waiting, new Date("2026-11-08T00:00:00Z"))).toBe(true);
    expect(isLate(shipped, new Date("2026-11-08T00:00:00Z"))).toBe(false);
  });
  it("the demo clock can move time forward without touching real time", () => {
    expect(addDays("2026-11-05T00:00:00Z", 2)).toBe("2026-11-07T00:00:00.000Z");
    expect(demoNow({ demoClockDays: 3 }).getTime() - Date.now()).toBeGreaterThan(3 * 86_400_000 - 1000);
  });
});

describe("the demo stores' customer service", () => {
  it("the store that never ships refuses and offers nothing", () => {
    expect(merchantReply(purchase("QuickGadgets Outlet", 9), "not_delivered").offer).toEqual({ kind: "none", amount: 0 });
  });
  it("the damaged-goods store offers half back", () => {
    expect(merchantReply(purchase("BrightHome", 30), "damaged").offer).toEqual({ kind: "partial_refund", amount: 15 });
  });
  it("a reliable store refunds in full", () => {
    expect(merchantReply(purchase("SoundHouse", 129), "damaged").offer).toEqual({ kind: "full_refund", amount: 129 });
  });
});
