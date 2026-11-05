// PayPal webhooks: the signature check sends the event back untouched, and each event lands on the right purchase or case.
import { describe, expect, it } from "vitest";
import { moneyBack } from "../case-money";
import { verificationBody } from "../paypal";
import { applyPayPalEvent, type RawEvent } from "../paypal-events";
import type { Db } from "../types";
import { storyDb } from "./fixtures";

const AT = "2026-11-05T08:00:00.000Z";
const db = (): Db => ({ ...storyDb(), vault: { vaultId: "VAULT-1", savedAt: AT } });
const event = (type: string, resource: RawEvent["resource"], id = `WH-${type}`): RawEvent => ({ id, event_type: type, create_time: AT, resource });

// From the sample story: coffee paid in full, the lamp partly refunded, the phone case escalated to a dispute.
const COFFEE = { id: "pur_2ac5eefb", capture: "9B64084806850934V", order: "9P647077A46511840" };
const LAMP = { purchase: "pur_4a3ca68d", capture: "63932821YJ955270K", case: "case_00f57d53", refund: "24X16871E2119482A" };
const PHONE = { purchase: "pur_9fdea9b6", capture: "7SY74024E3395724U", case: "case_aef2004a", dispute: "PP-R-UFK-10196532" };

describe("verificationBody", () => {
  it("sends the event back to PayPal exactly as it arrived", () => {
    const raw = '{"id":"WH-1", "resource":{"amount":{"value":"10.50"}},"n":1.50}';
    const body = verificationBody(
      { authAlgo: "SHA256withRSA", certUrl: "https://api.sandbox.paypal.com/cert", transmissionId: "t-1", transmissionSig: "sig==", transmissionTime: AT },
      "WEBHOOK-9",
      raw,
    );
    expect(body.endsWith(`"webhook_event":${raw}}`)).toBe(true);
    const parsed = JSON.parse(body);
    expect(parsed.webhook_id).toBe("WEBHOOK-9");
    expect(parsed.transmission_sig).toBe("sig==");
    expect(parsed.webhook_event.resource.amount.value).toBe("10.50");
  });
});

describe("applyPayPalEvent", () => {
  it("links a completed capture to its purchase", () => {
    const d = db();
    const e = applyPayPalEvent(d, event("PAYMENT.CAPTURE.COMPLETED", { id: COFFEE.capture, amount: { value: "18.00" }, supplementary_data: { related_ids: { order_id: COFFEE.order } } }), AT);
    expect(e?.purchaseId).toBe(COFFEE.id);
    expect(e?.summary).toBe("PayPal confirmed $18.00 was paid to Bean & Leaf Market.");
    expect(d.paypalEvents?.[0].id).toBe(e?.id);
  });

  it("applies each event once, however often PayPal resends it", () => {
    const d = db();
    const e = event("PAYMENT.CAPTURE.COMPLETED", { id: COFFEE.capture });
    expect(applyPayPalEvent(d, e, AT)).not.toBeNull();
    expect(applyPayPalEvent(d, e, AT)).toBeNull();
    expect(d.paypalEvents).toHaveLength(1);
  });

  it("finds a refund's purchase and case through the capture it links up to", () => {
    const d = db();
    const e = applyPayPalEvent(
      d,
      event("PAYMENT.CAPTURE.REFUNDED", {
        id: LAMP.refund,
        status: "COMPLETED",
        amount: { value: "15.00" },
        links: [{ rel: "up", href: `https://api.sandbox.paypal.com/v2/payments/captures/${LAMP.capture}` }],
      }),
      AT,
    );
    expect(e?.purchaseId).toBe(LAMP.purchase);
    expect(e?.caseId).toBe(LAMP.case);
    expect(e?.summary).toBe("PayPal confirmed $15.00 was refunded to you.");
  });

  it("does not repeat news Minder already gave when PayPal confirms a new dispute", () => {
    const d = db();
    const before = d.cases.find((c) => c.id === PHONE.case)!.messages.length;
    applyPayPalEvent(d, event("CUSTOMER.DISPUTE.CREATED", { dispute_id: PHONE.dispute, status: "OPEN", dispute_amount: { value: "9.00" } }), AT);
    expect(d.cases.find((c) => c.id === PHONE.case)!.messages).toHaveLength(before);
  });

  it("tells the owner when the dispute moves on", () => {
    const d = db();
    applyPayPalEvent(d, event("CUSTOMER.DISPUTE.UPDATED", { dispute_id: PHONE.dispute, status: "WAITING_FOR_SELLER_RESPONSE" }), AT);
    const c = d.cases.find((x) => x.id === PHONE.case)!;
    expect(c.dispute?.status).toBe("WAITING_FOR_SELLER_RESPONSE");
    expect(c.messages.at(-1)).toMatchObject({ from: "paypal", text: "PayPal is waiting for the store to respond." });
  });

  it("closes the case and counts the money when PayPal decides for the owner", () => {
    const d = db();
    const e = applyPayPalEvent(
      d,
      event("CUSTOMER.DISPUTE.RESOLVED", {
        dispute_id: PHONE.dispute,
        status: "RESOLVED",
        dispute_amount: { value: "9.00" },
        dispute_outcome: { outcome_code: "RESOLVED_BUYER_FAVOUR", amount_refunded: { value: "9.00" } },
        disputed_transactions: [{ seller_transaction_id: PHONE.capture }],
      }),
      AT,
    );
    const c = d.cases.find((x) => x.id === PHONE.case)!;
    expect(e?.caseId).toBe(PHONE.case);
    expect(c.status).toBe("closed");
    expect(c.dispute?.outcome).toBe("RESOLVED_BUYER_FAVOUR");
    expect(moneyBack(c)).toBe(9);
    expect(c.messages.at(-1)?.text).toBe("PayPal decided in your favour: $9.00 goes back to you.");
  });

  it("stops paying when the owner removes Minder's permission in PayPal, and starts again when it is saved", () => {
    const d = db();
    applyPayPalEvent(d, event("VAULT.PAYMENT-TOKEN.DELETED", { id: "SOMEONE-ELSE" }), AT);
    expect(d.vaultRevokedAt).toBeUndefined();
    applyPayPalEvent(d, event("VAULT.PAYMENT-TOKEN.DELETED", { id: "VAULT-1" }, "WH-del"), AT);
    expect(d.vaultRevokedAt).toBe(AT);
    applyPayPalEvent(d, event("VAULT.PAYMENT-TOKEN.CREATED", { id: "VAULT-1" }), AT);
    expect(d.vaultRevokedAt).toBeUndefined();
  });

  it("keeps an event about a payment this copy does not know, without linking it", () => {
    const d = db();
    const e = applyPayPalEvent(d, event("PAYMENT.AUTHORIZATION.VOIDED", { id: "UNKNOWN", amount: { value: "5.00" } }), AT);
    expect(e?.purchaseId).toBeUndefined();
    expect(e?.summary).toBe("PayPal released the $5.00 it was holding. Nothing was charged.");
  });
});
