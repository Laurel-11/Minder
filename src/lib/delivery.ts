// What happens after a purchase is paid. Demo stores ship (or don't) according to their personality.
import { addDays } from "./clock";
import { findStoreByName } from "./catalog";
import { log } from "./log";
import { addTracking } from "./paypal";
import type { Delivery, Purchase } from "./types";

const TRANSIT_DAYS = 2;

/** Called right after money moves. Returns the delivery record to store on the purchase. */
export async function shipAfterPayment(p: Purchase, now: Date): Promise<Delivery> {
  const store = findStoreByName(p.request.merchant.name);
  const promisedBy = addDays(now, 2);
  if (!store || store.fulfillment === "never_ships") return { state: "awaiting_shipment", promisedBy };

  const delivery: Delivery = {
    state: "shipped",
    promisedBy,
    shippedAt: now.toISOString(),
    carrier: "USPS",
    trackingNumber: `9400${Math.floor(1e15 + Math.random() * 9e15)}`.slice(0, 22),
    arrivesDamaged: store.fulfillment === "ships_damaged",
  };
  if (p.paypal.orderId && p.paypal.captureId) {
    try {
      await addTracking({ orderId: p.paypal.orderId, captureId: p.paypal.captureId, trackingNumber: delivery.trackingNumber!, carrier: "USPS" });
      delivery.trackedInPayPal = true;
    } catch (e) {
      log("delivery.tracking_failed", { id: p.id, error: (e as Error).message });
    }
  }
  return delivery;
}

/** The delivery state at a given moment (shipped parcels arrive after a couple of days). */
export function deliveryNow(d: Delivery, now: Date): Delivery {
  if (d.state === "shipped" && d.shippedAt && now.getTime() >= new Date(addDays(d.shippedAt, TRANSIT_DAYS)).getTime()) {
    return { ...d, state: "delivered" };
  }
  return d;
}

export function isLate(d: Delivery, now: Date): boolean {
  return d.state === "awaiting_shipment" && now.getTime() > new Date(d.promisedBy).getTime();
}
