// The demo stores' customer-service agent: the other side of the deal. It acts on PayPal through PayPal's own
// Agent Toolkit (@paypal/agent-toolkit), the tools PayPal offers merchants for their AI agents. DeepSeek picks the
// tool and fills it in (function calling); the call is checked against what was agreed before it runs, and if no
// model answers the agreed call runs as is. Minder never moves the store's money itself.
import crypto from "node:crypto";
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";
import { zodToJsonSchema } from "zod-to-json-schema";
import { pickTool, type ToolSpec } from "./ai";
import { env } from "./env";
import { log } from "./log";
import { toValue, usd } from "./money";

type Actions = Record<string, Record<string, boolean>>;
type Json = Record<string, unknown>;

/** One toolkit per action, so the PayPal-Request-Id (the toolkit's request_id) is specific to it: a retry can never refund twice. */
function toolkit(actions: Actions, requestId?: string) {
  return new PayPalAgentToolkit({
    clientId: env.paypalClientId,
    clientSecret: env.paypalClientSecret,
    configuration: { actions, context: { sandbox: true, ...(requestId && { request_id: requestId }) } },
  });
}

type ToolkitTool = { description?: string; parameters: unknown; execute?: (args: unknown, options: unknown) => Promise<unknown> };
const toolsOf = (tk: PayPalAgentToolkit) => tk.getTools() as unknown as Record<string, ToolkitTool>;

/** The toolkit's own description and parameters, in the shape function calling expects. */
function specOf(name: string, tool: ToolkitTool): ToolSpec {
  const parameters = zodToJsonSchema(tool.parameters as Parameters<typeof zodToJsonSchema>[0], { target: "openAi" }) as Json;
  delete parameters.$schema;
  return { name, description: (tool.description ?? name).trim().slice(0, 1000), parameters };
}

/** Run a toolkit tool. The toolkit answers errors as JSON text instead of throwing, so look inside. */
async function run(tool: ToolkitTool, name: string, args: Json): Promise<Json> {
  const out = await tool.execute!(args, { toolCallId: crypto.randomUUID(), messages: [] });
  const parsed = (typeof out === "string" ? JSON.parse(out || "{}") : out) as Json & { error?: { message?: string }; message?: string; code?: string };
  if (parsed?.error || (parsed?.code && parsed?.message && !parsed?.id)) {
    throw new Error(`PayPal Agent Toolkit ${name}: ${parsed.error?.message ?? parsed.message}`);
  }
  return parsed;
}

export type StoreAction = { tool: string; decidedBy: string; message: string; result: Json };

/**
 * Ask the store's agent to make one toolkit call. `expected` is what was agreed: the model may word the
 * note to the customer, but never changes who is paid or how much.
 */
async function act(input: {
  store: string;
  actions: Actions;
  requestId?: string;
  tool: string;
  situation: string;
  expected: Json;
  noteField?: string;
  fallbackNote: string;
}): Promise<StoreAction> {
  const tk = toolkit(input.actions, input.requestId);
  const tool = toolsOf(tk)[input.tool];
  if (!tool?.execute) throw new Error(`The PayPal Agent Toolkit has no ${input.tool} tool.`);

  const picked = await pickTool({
    system: `You are the customer-service agent for ${input.store}, an online store. You act on PayPal only through the tools you are given. Make exactly one tool call that carries out what the situation says. Write any note to the customer in one or two plain, polite sentences.`,
    prompt: input.situation,
    tools: [specOf(input.tool, tool)],
  });
  const note = input.noteField && typeof picked?.args[input.noteField] === "string" && (picked.args[input.noteField] as string).trim();
  const args: Json = { ...input.expected, ...(input.noteField && { [input.noteField]: (note || input.fallbackNote).slice(0, 255) }) };
  const changed = picked && Object.keys(input.expected).some((k) => JSON.stringify(picked.args[k]) !== JSON.stringify(input.expected[k]));
  if (changed) log("store_agent.corrected", { tool: input.tool, wanted: input.expected, got: picked!.args });

  const result = await run(tool, input.tool, args);
  const decidedBy = picked ? `${picked.model} with PayPal Agent Toolkit` : "PayPal Agent Toolkit (no model answered, agreed call used)";
  log("store_agent.acted", { store: input.store, tool: input.tool, decidedBy });
  return { tool: input.tool, decidedBy, message: String(args[input.noteField ?? ""] ?? input.fallbackNote), result };
}

/** The store refunds a capture after the buyer accepted its offer. */
export async function storeRefunds(input: { store: string; captureId: string; amount: number; reason: string }) {
  const value = toValue(input.amount);
  const action = await act({
    store: input.store,
    actions: { payments: { createRefund: true } },
    requestId: `${input.captureId}:refund:${value}`,
    tool: "create_refund",
    situation: `The customer accepted your offer: refund ${usd(input.amount)} (USD ${value}) of PayPal capture ${input.captureId}. Reason: ${input.reason}. Issue that refund now.`,
    expected: { capture_id: input.captureId, amount: { currency_code: "USD", value } },
    noteField: "note_to_payer",
    fallbackNote: `Refund of ${usd(input.amount)} from ${input.store}, as agreed.`,
  });
  return { refundId: String(action.result.id ?? ""), status: String(action.result.status ?? "PENDING"), action };
}

/** The store looks at a PayPal dispute and, with no proof that it shipped, accepts the buyer's claim. */
export async function storeAnswersDispute(input: { store: string; disputeId: string; problem: "not_delivered" | "damaged" }) {
  const read = toolkit({ disputes: { get: true } });
  const dispute = await run(toolsOf(read).get_dispute, "get_dispute", { dispute_id: input.disputeId });
  const status = String(dispute.status ?? "");
  if (status !== "WAITING_FOR_SELLER_RESPONSE") return { answered: false as const, status };
  const amount = (dispute.dispute_amount as { value?: string } | undefined)?.value;
  const action = await act({
    store: input.store,
    actions: { disputes: { create: true } },
    requestId: `${input.disputeId}:accept-claim`,
    tool: "accept_dispute_claim",
    situation: `PayPal dispute ${input.disputeId} (${amount ? `USD ${amount}, ` : ""}reason ${String(dispute.reason ?? "unknown")}) is waiting for your response. ${
      input.problem === "not_delivered" ? "Your records show the order was never shipped and there is no tracking number" : "The customer reported the item arrived damaged and you have no evidence otherwise"
    }, so you cannot win it. Accept the buyer's claim, with a short note explaining why.`,
    expected: { dispute_id: input.disputeId },
    noteField: "note",
    fallbackNote: input.problem === "not_delivered" ? "We cannot show the order shipped, so we accept the claim." : "We accept the claim for the damaged item.",
  });
  return { answered: true as const, status, action };
}
