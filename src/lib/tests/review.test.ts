// The reviewer names each order for the replay file, except in the exam, which must grade the live AI.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { request, story } from "./fixtures";

type Call = { replay?: { key: string; label: string } };
const calls: Call[] = [];
vi.mock("../ai", () => ({
  generateJson: async (input: Call) => {
    calls.push(input);
    return {
      data: {
        verdict: "approve",
        matchesInstruction: true,
        instructionMatch: "Matches.",
        manipulationSuspected: false,
        manipulationEvidence: "",
        riskFlags: [],
        summaryForOwner: "Fine.",
      },
      model: "test-model",
    };
  },
}));
const { reviewPurchase } = await import("../review");

const order = request([{ name: "Medium roast beans, 1 kg", price: 18 }]);
const review = (liveOnly?: boolean) => reviewPurchase({ request: order, total: 18, recent: [], liveOnly });

describe("reviewPurchase replay key", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("names the order so a recorded answer can stand in when the AI is down", async () => {
    await review();
    expect(calls[0].replay?.key).toContain("Bean & Leaf Market");
    expect(calls[0].replay?.label).toBe('Review: Bean & Leaf Market, "Buy me a bag of coffee beans."');
  });

  it("gives the same order the same key, whatever the history", async () => {
    await review();
    await reviewPurchase({ request: order, total: 18, recent: story().slice(0, 3) });
    expect(calls[0].replay?.key).toBe(calls[1].replay?.key);
  });

  it("never records or replays in the exam", async () => {
    await review(true);
    expect(calls[0].replay).toBeUndefined();
  });
});
