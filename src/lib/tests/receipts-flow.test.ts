// The receipt book through a whole purchase: the decision is written before PayPal sees the order, PayPal's order
// carries its fingerprint, and a claim or dispute cites the receipts as evidence. PayPal and the AI are stand-ins.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiReview, Db } from "../types";
import { request } from "./fixtures";

let db: Db;
vi.mock("../db", () => ({
  readDb: async () => structuredClone(db),
  readSharedDb: async () => structuredClone(db),
  updateDb: async <T,>(fn: (d: Db) => T | Promise<T>) => fn(db),
}));

const orders: { customId?: string; intent: string; receiptsWhenOrdered: number }[] = [];
const chargebacks: { note: string }[] = [];
vi.mock("../paypal", () => ({
  createVaultedOrder: async (input: { customId?: string; intent: string }) => {
    orders.push({ customId: input.customId, intent: input.intent, receiptsWhenOrdered: db.receipts?.length ?? 0 });
    return input.intent === "CAPTURE" ? { orderId: "ORDER-1", status: "COMPLETED", captureId: "CAPTURE-1" } : { orderId: "ORDER-2", status: "COMPLETED", authorizationId: "AUTH-2" };
  },
  captureAuthorization: async () => ({ captureId: "CAPTURE-2", status: "COMPLETED" }),
  voidAuthorization: async () => undefined,
  simulateChargeback: async (input: { note: string }) => {
    chargebacks.push(input);
    return { disputeId: "PP-D-1" };
  },
  getDispute: async () => ({ dispute_id: "PP-D-1", status: "OPEN" }),
  CHARGEBACK_REASON: { not_delivered: "1310", damaged: "1330" },
}));
vi.mock("../delivery", async (orig) => ({
  ...(await orig<typeof import("../delivery")>()),
  shipAfterPayment: async (_p: unknown, now: Date) => ({ state: "awaiting_shipment", promisedBy: new Date(now.getTime() + 2 * 86_400_000).toISOString() }),
}));
let verdict: AiReview["verdict"] = "approve";
vi.mock("../review", () => ({
  reviewPurchase: async (): Promise<AiReview> => ({
    verdict,
    matchesInstruction: verdict === "approve",
    instructionMatch: "Matches.",
    manipulationSuspected: false,
    manipulationEvidence: "",
    riskFlags: [],
    summaryForOwner: "This is what you asked for.",
    model: "test",
  }),
}));
vi.mock("../recovery-ai", () => ({
  writeClaim: async () => ({ claim: "Dear store, the order never shipped. Please refund it.", askFor: { kind: "full_refund", amount: 18 } }),
  judgeOffer: async () => ({ action: "escalate", reasoning: "They offered nothing." }),
}));

const { handlePurchaseRequest, decideHeldPurchase } = await import("../purchases");
const { openCase, resolveCase } = await import("../recovery");
const { checkBook, useSigningSeed } = await import("../receipts");
const { freshDb } = await import("../seed");

beforeEach(() => {
  useSigningSeed(new Uint8Array(32).fill(3));
  db = { ...freshDb({ story: false, vault: { vaultId: "VAULT-1", savedAt: "2026-11-01T00:00:00Z" } }), receipts: [] };
  orders.length = 0;
  chargebacks.length = 0;
  verdict = "approve";
});

describe("a paid purchase", () => {
  it("writes the decision first and puts its fingerprint on the PayPal order", async () => {
    const p = await handlePurchaseRequest(request([{ name: "Medium roast whole beans, 1 kg", price: 18 }]));
    const [decided, paid, delivery] = db.receipts!;
    expect(orders).toEqual([{ customId: decided.hash, intent: "CAPTURE", receiptsWhenOrdered: 1 }]);
    expect(p.paypal.receiptOnOrder).toBe(decided.hash);
    expect(db.receipts!.map((r) => r.kind)).toEqual(["decision", "paypal", "delivery"]);
    expect(paid.says).toBe("PayPal paid $18.00 to Bean & Leaf Market (order ORDER-1, capture CAPTURE-1).");
    expect(delivery.says).toMatch(/^Bean & Leaf Market promised to ship it by /);
    expect(checkBook(db.receipts!).ok).toBe(true);
  });

  it("writes only the decision when Minder blocks, because no money moves", async () => {
    await handlePurchaseRequest(request([{ name: "Gift card", price: 50, category: "gift_cards" }]));
    expect(orders).toEqual([]);
    expect(db.receipts!.map((r) => r.kind)).toEqual(["decision"]);
    expect(db.receipts![0].says).toMatch(/^Minder blocked \$50\.00 at Bean & Leaf Market: you never allow gift cards/);
  });

  it("records the owner's signature on a held purchase", async () => {
    const p = await handlePurchaseRequest(request([{ name: "Wireless over-ear headphones", price: 129, category: "electronics" }]));
    expect(orders[0].intent).toBe("AUTHORIZE");
    await decideHeldPurchase(p.id, "approve");
    expect(db.receipts!.map((r) => r.kind)).toEqual(["decision", "paypal", "owner", "delivery"]);
    expect(db.receipts![2].says).toBe("You signed: PayPal sent the $129.00 it was holding to Bean & Leaf Market (capture CAPTURE-2).");
  });
});

describe("getting money back", () => {
  it("cites the purchase's receipts in the claim and hands PayPal a pointer to them", async () => {
    const p = await handlePurchaseRequest(request([{ name: "Medium roast whole beans, 1 kg", price: 18 }]));
    const c = await openCase(p.id, "not_delivered", "minder");
    expect(c.messages[0].text).toContain("Evidence: Minder's signed receipts #1, #2, #3 for this order. The PayPal order ORDER-1 carries the fingerprint of receipt #1.");
    const claim = db.receipts!.at(-1)!;
    expect(claim.kind).toBe("claim");
    expect((claim.facts as { cites: { n: number }[] }).cites.map((x) => x.n)).toEqual([1, 2, 3]);

    await resolveCase(c.id, "escalate");
    const lastBeforeDispute = db.receipts!.at(-2)!;
    expect(chargebacks[0].note.startsWith(`[Minder receipt #${lastBeforeDispute.n} ${lastBeforeDispute.hash.slice(0, 16)}]`)).toBe(true);
    const dispute = db.receipts!.at(-1)!;
    expect(dispute.says).toBe("Minder took it to PayPal: dispute PP-D-1 for $18.00, with receipts #1 to #4 as evidence.");
    expect(checkBook(db.receipts!).ok).toBe(true);
  });
});
