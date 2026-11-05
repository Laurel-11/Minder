// The store's agent: PayPal Agent Toolkit calls with an idempotency key, and the model can word the note but never change the money.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Config = { actions: Record<string, Record<string, boolean>>; context: { sandbox: boolean; request_id?: string } };
const made: Config[] = [];
const ran: { name: string; args: Record<string, unknown> }[] = [];
let answers: Record<string, unknown> = {};

vi.mock("@paypal/agent-toolkit/ai-sdk", async () => {
  const { z } = await import("zod");
  const tool = (name: string, parameters: unknown) => ({
    description: `PayPal tool ${name}`,
    parameters,
    execute: async (args: Record<string, unknown>) => {
      ran.push({ name, args });
      return JSON.stringify(answers[name] ?? {});
    },
  });
  return {
    PayPalAgentToolkit: class {
      constructor({ configuration }: { configuration: Config }) {
        made.push(configuration);
      }
      getTools() {
        return {
          create_refund: tool("create_refund", z.object({ capture_id: z.string(), amount: z.object({ currency_code: z.string(), value: z.string() }).optional(), note_to_payer: z.string().optional() })),
          get_dispute: tool("get_dispute", z.object({ dispute_id: z.string() })),
          accept_dispute_claim: tool("accept_dispute_claim", z.object({ dispute_id: z.string(), note: z.string() })),
        };
      }
    },
  };
});

let picked: { name: string; args: Record<string, unknown>; model: string } | null = null;
vi.mock("../ai", () => ({ pickTool: async () => picked }));

const { storeAnswersDispute, storeRefunds } = await import("../store-agent");

beforeEach(() => {
  made.length = 0;
  ran.length = 0;
  answers = {};
  picked = null;
});

describe("storeRefunds", () => {
  it("refunds exactly the agreed amount, with a PayPal-Request-Id tied to the capture and amount", async () => {
    answers.create_refund = { id: "REF-1", status: "COMPLETED" };
    picked = { name: "create_refund", args: { capture_id: "CAP-9", amount: { currency_code: "USD", value: "99.00" }, note_to_payer: "Sorry about the lamp." }, model: "test-model" };
    const r = await storeRefunds({ store: "BrightHome", captureId: "CAP-9", amount: 15, reason: "item arrived damaged" });
    expect(made[0]).toMatchObject({ actions: { payments: { createRefund: true } }, context: { sandbox: true, request_id: "CAP-9:refund:15.00" } });
    expect(ran[0].args).toEqual({ capture_id: "CAP-9", amount: { currency_code: "USD", value: "15.00" }, note_to_payer: "Sorry about the lamp." });
    expect(r).toMatchObject({ refundId: "REF-1", status: "COMPLETED" });
    expect(r.action.decidedBy).toBe("test-model with PayPal Agent Toolkit");
  });

  it("still refunds when no model answers", async () => {
    answers.create_refund = { id: "REF-2", status: "COMPLETED" };
    const r = await storeRefunds({ store: "BrightHome", captureId: "CAP-9", amount: 15, reason: "damaged" });
    expect(ran[0].args.note_to_payer).toBe("Refund of $15.00 from BrightHome, as agreed.");
    expect(r.action.decidedBy).toContain("no model answered");
  });

  it("reports a PayPal error the toolkit returned as text", async () => {
    answers.create_refund = { error: { message: "CAPTURE_FULLY_REFUNDED", type: "paypal_error" } };
    await expect(storeRefunds({ store: "BrightHome", captureId: "CAP-9", amount: 15, reason: "damaged" })).rejects.toThrow("CAPTURE_FULLY_REFUNDED");
  });
});

describe("storeAnswersDispute", () => {
  it("waits until PayPal passes the dispute to the store", async () => {
    answers.get_dispute = { dispute_id: "PP-D-1", status: "OPEN" };
    const r = await storeAnswersDispute({ store: "QuickGadgets Outlet", disputeId: "PP-D-1", problem: "not_delivered" });
    expect(r).toEqual({ answered: false, status: "OPEN" });
    expect(ran.map((x) => x.name)).toEqual(["get_dispute"]);
  });

  it("accepts the claim on the right dispute, once", async () => {
    answers.get_dispute = { dispute_id: "PP-D-1", status: "WAITING_FOR_SELLER_RESPONSE", dispute_amount: { value: "9.00" } };
    answers.accept_dispute_claim = { links: [] };
    picked = { name: "accept_dispute_claim", args: { dispute_id: "PP-D-OTHER", note: "We never shipped it, so we accept." }, model: "test-model" };
    const r = await storeAnswersDispute({ store: "QuickGadgets Outlet", disputeId: "PP-D-1", problem: "not_delivered" });
    expect(r.answered).toBe(true);
    expect(ran[1]).toEqual({ name: "accept_dispute_claim", args: { dispute_id: "PP-D-1", note: "We never shipped it, so we accept." } });
    expect(made[1].context.request_id).toBe("PP-D-1:accept-claim");
  });
});
