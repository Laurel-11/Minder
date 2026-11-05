// The central safety claim: the AI review can make a decision stricter, never looser.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiReview, Outcome } from "../types";
import { policy, request } from "./fixtures";

// A plain stand-in for the AI reviewer (no spy, so a deliberate failure is not reported twice).
let reviewer: () => Promise<AiReview> = async () => {
  throw new Error("no reviewer set");
};
let reviews = 0;
vi.mock("../review", () => ({
  reviewPurchase: () => {
    reviews++;
    return reviewer();
  },
}));
const { assessPurchase } = await import("../purchases");
const { worst } = await import("../rules");

const ai = (verdict: Outcome, extra: Partial<AiReview> = {}): AiReview => ({
  verdict,
  matchesInstruction: verdict === "approve",
  instructionMatch: "",
  manipulationSuspected: verdict === "block",
  manipulationEvidence: "",
  riskFlags: [],
  summaryForOwner: `The reviewer says ${verdict}.`,
  model: "test-model",
  ...extra,
});

// One request per code-limit outcome.
const BY_RULES: Record<Outcome, ReturnType<typeof request>> = {
  approve: request([{ name: "Coffee", price: 18 }]),
  hold: request([{ name: "Headphones", price: 129, category: "electronics" }]),
  block: request([{ name: "Gift card", price: 50, category: "gift_cards" }]),
};
const SEVERITY: Record<Outcome, number> = { approve: 0, hold: 1, block: 2 };

beforeEach(() => {
  reviews = 0;
});

describe("rules first, then the AI review", () => {
  for (const rules of ["approve", "hold", "block"] as Outcome[]) {
    for (const verdict of ["approve", "hold", "block"] as Outcome[]) {
      it(`code says ${rules}, AI says ${verdict}: the decision is never looser than the code`, async () => {
        reviewer = async () => ai(verdict);
        const r = await assessPurchase({ policy: policy(), request: BY_RULES[rules], history: [] });
        expect(SEVERITY[r.decision]).toBeGreaterThanOrEqual(SEVERITY[rules]);
        expect(r.decision).toBe(rules === "block" ? "block" : worst(rules, verdict));
      });
    }
  }

  it("does not even ask the AI when the code already blocks", async () => {
    const r = await assessPurchase({ policy: policy(), request: BY_RULES.block, history: [] });
    expect(reviews).toBe(0);
    expect(r.decision).toBe("block");
  });

  it("fails safe: if the AI is down, an order the code allows waits for the owner", async () => {
    reviewer = async () => {
      throw new Error("AI is unavailable right now");
    };
    const r = await assessPurchase({ policy: policy(), request: BY_RULES.approve, history: [] });
    expect(r.decision).toBe("hold");
    expect(r.reasons.join(" ")).toContain("unavailable");
  });

  it("says so when the AI's answer is a recorded one", async () => {
    reviewer = async () => ai("approve", { recorded: true });
    const r = await assessPurchase({ policy: policy(), request: BY_RULES.approve, history: [] });
    expect(r.decision).toBe("approve");
    expect(r.reasons.at(-1)).toContain("recorded review");
  });
});
