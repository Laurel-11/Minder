// How much came back to the owner, and PayPal's dispute states in plain words.
import { describe, expect, it } from "vitest";
import { disputeInWords, disputeWon, moneyBack, outcomeInWords } from "../case-money";
import type { RecoveryCase } from "../types";

const base: RecoveryCase = {
  id: "case_1",
  purchaseId: "pur_1",
  createdAt: "2026-11-05T00:00:00Z",
  problem: "damaged",
  openedBy: "owner",
  timeline: [],
  askFor: { kind: "full_refund", amount: 30 },
  messages: [],
  status: "offer_to_review",
};

describe("moneyBack", () => {
  it("counts an accepted refund", () => {
    expect(moneyBack({ ...base, status: "refunded", refund: { refundId: "R1", amount: 15, status: "COMPLETED" } })).toBe(15);
  });
  it("counts a dispute only when PayPal settled it for the owner", () => {
    const won = { ...base, status: "escalated", dispute: { outcome: "RESOLVED_BUYER_FAVOUR", amount: 9 } } as unknown as RecoveryCase;
    const lost = { ...base, status: "escalated", dispute: { outcome: "RESOLVED_SELLER_FAVOUR", amount: 9 } } as unknown as RecoveryCase;
    expect(disputeWon(won)).toBe(true);
    expect(moneyBack(won)).toBe(9);
    expect(disputeWon(lost)).toBe(false);
    expect(moneyBack(lost)).toBe(0);
  });
  it("is zero while a case is still open, or when there is no case", () => {
    expect(moneyBack(base)).toBe(0);
    expect(moneyBack(undefined)).toBe(0);
  });
});

describe("PayPal's dispute words", () => {
  it("translates the status, with a safe default for anything new", () => {
    expect(disputeInWords("WAITING_FOR_SELLER_RESPONSE")).toBe("PayPal is waiting for the store to respond.");
    expect(disputeInWords("SOMETHING_NEW")).toBe("PayPal is handling the case.");
  });
  it("words the outcome with or without an amount", () => {
    expect(outcomeInWords("RESOLVED_BUYER_FAVOUR", "$9.00")).toBe("PayPal decided in your favour: $9.00 goes back to you.");
    expect(outcomeInWords("RESOLVED_BUYER_FAVOUR")).toBe("PayPal decided in your favour.");
    expect(outcomeInWords("ACCEPTED", "$9.00")).toBe("The store accepted your claim: $9.00 goes back to you.");
    expect(outcomeInWords(undefined)).toBe("PayPal closed the case.");
  });
});
