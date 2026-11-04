// Chaperone's AI agent team for AG Studio. Studio's built-in agents (lead, data, page, widget,
// planning) keep building the dashboard; two agents of ours join them:
//   - the auditor answers questions about specific purchases and checks them against PayPal's own
//     records, and can put a waiting purchase in front of the owner as a cheque to sign;
//   - the rules advisor replays past purchases under different limits.
// The lead is Studio's own, told about the two newcomers and allowed to delegate to them.
import {
  directLlmRunner,
  type AgAiAgentContext,
  type AgAiHarnessBuilderContext,
  type AgAiHarnessConfig,
  type AgAiPromptStarter,
  type AgAnyAiAgentDefinition,
  type AgStudioApi,
} from "ag-studio";
import { geminiAdapter } from "@/lib/studio-adapter";
import type { PurchaseRecord, Verification, WhatIf } from "@/lib/studio-tools";
import { CATEGORIES } from "@/lib/types";

async function getJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(url, init);
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(j.error ?? `${r.status} ${r.statusText}`);
  return j;
}

/** Fired when the auditor prepares a cheque; the dashboard listens and shows it to the owner. */
export const CHEQUE_EVENT = "chaperone:cheque";

const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

/** One line per purchase for the model: everything it needs, nothing it does not. */
const brief = (m: PurchaseRecord) =>
  JSON.stringify({
    purchaseId: m.purchaseId,
    date: m.date,
    store: m.store,
    ownerAsked: m.ownerAsked,
    items: m.items,
    total: m.total,
    status: m.status,
    settledBy: m.whichCheck,
    reasons: m.reasons,
    rulesThatFired: m.failedRules,
    aiReview: m.ai,
    paypalOrderId: m.paypal.orderId ?? null,
    recoveryCase: m.case,
  });

export function chaperoneTools(api: AgStudioApi) {
  const lookUp = api.defineAiTool({
    name: "look_up_purchase",
    description:
      "Find purchases in Chaperone's log by id (pur_...), store name, item, or a few words from the owner's request. Returns up to 3 full records: what the owner asked for, the items, the status, which check settled it, every rule that fired, the AI review (including any text the store's page aimed at the agent), the PayPal order id and any recovery case.",
    params: (s) => s.object({ query: s.string({ description: "A purchase id, a store name, an item, or words from the owner's request." }) }),
    execute: async ({ query }: { query: string }, ctx) => {
      try {
        const { matches } = await getJson<{ matches: PurchaseRecord[] }>(`/api/studio/purchases?q=${encodeURIComponent(query)}`, { signal: ctx.signal });
        if (!matches.length) return ctx.error(`No purchase matches "${query}". Try a store name or an item.`);
        return ctx.success(matches.map(brief).join("\n"), { matches });
      } catch (e) {
        return ctx.error((e as Error).message);
      }
    },
  });

  const verify = api.defineAiTool({
    name: "verify_with_paypal",
    description:
      "Look a purchase up in PayPal's own records (the order, the money held or captured, any refund and any dispute) and compare each with Chaperone's record. Use it whenever the owner asks if money really moved, if a refund is real, or wants proof.",
    params: (s) => s.object({ purchaseId: s.string({ description: "The purchase id, pur_ followed by 8 characters. Find it with look_up_purchase first." }) }),
    execute: async ({ purchaseId }: { purchaseId: string }, ctx) => {
      try {
        const v = await getJson<Verification>(`/api/studio/verify?purchaseId=${encodeURIComponent(purchaseId)}`, { signal: ctx.signal });
        return ctx.success(JSON.stringify({ summary: v.summary, checks: v.checks }), v);
      } catch (e) {
        return ctx.error((e as Error).message);
      }
    },
  });

  const prepareApproval = api.defineAiTool({
    name: "prepare_approval",
    description:
      "Show the owner a purchase that is waiting for their decision as a cheque with 'Sign and pay' and 'Decline' buttons. Only the owner's click moves money; this tool cannot approve or decline anything itself.",
    params: (s) => s.object({ purchaseId: s.string({ description: "The id of a purchase whose status is 'Waiting for you'." }) }),
    execute: async ({ purchaseId }: { purchaseId: string }, ctx) => {
      try {
        const { matches } = await getJson<{ matches: PurchaseRecord[] }>(`/api/studio/purchases?q=${encodeURIComponent(purchaseId)}`, { signal: ctx.signal });
        const m = matches[0];
        if (!m || m.purchaseId !== purchaseId) return ctx.error(`No purchase ${purchaseId}.`);
        if (!m.waitingForOwner) return ctx.error(`${m.store} ${usd(m.total)} is not waiting for the owner (status: ${m.status}).`);
        // The dashboard shows the cheque above the report too, where the owner cannot miss it.
        window.dispatchEvent(new CustomEvent<PurchaseRecord>(CHEQUE_EVENT, { detail: m }));
        return ctx.success(
          `A cheque for ${usd(m.total)} to ${m.store} is now on screen with Sign and pay and Decline buttons. Tell the owner to press one; you cannot press it for them.`,
          m,
        );
      } catch (e) {
        return ctx.error((e as Error).message);
      }
    },
  });

  const simulate = api.defineAiTool({
    name: "simulate_rules",
    description:
      "Replay every past purchase through Chaperone's real rules code with some rules changed, and report which purchases would have gone differently. Changes nothing. Give only the changes you want to test.",
    params: (s) =>
      s.object({
        approvalThreshold: s.number({ description: "Ask the owner first for any purchase above this many dollars." }).optional(),
        perPurchaseMax: s.number({ description: "Block any purchase above this many dollars." }).optional(),
        budgetLimit: s.number({ description: "New dollar limit for the owner's first budget (the food budget)." }).optional(),
        budgetPeriod: s.enum(["day", "week", "month"], { description: "New period for that budget." }).optional(),
        blockStores: s.array(s.string(), { description: "Store names to block." }).optional(),
        unblockStores: s.array(s.string(), { description: "Store names to take off the blocked list." }).optional(),
        blockCategories: s.array(s.enum([...CATEGORIES]), { description: "Categories to never allow." }).optional(),
        allowCategories: s.array(s.enum([...CATEGORIES]), { description: "Blocked categories to allow again." }).optional(),
      }),
    execute: async (changes: Record<string, unknown>, ctx) => {
      try {
        const w = await getJson<WhatIf>("/api/studio/simulate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(changes),
          signal: ctx.signal,
        });
        return ctx.success(JSON.stringify({ changesTested: w.changes, summary: w.summary, changed: w.rows.filter((r) => r.changed) }), w);
      } catch (e) {
        return ctx.error((e as Error).message);
      }
    },
  });

  return { lookUp, verify, prepareApproval, simulate };
}

const AUDITOR = `## Role
You are Chaperone's purchase auditor. Chaperone checks every purchase the owner's AI shopping agent (ShopBot) tries to make: first hard code limits, then an AI review of the store's page, then the owner's own signature for anything held. You answer questions about specific purchases.

## How to work
1. Call look_up_purchase to find the purchase (by id, store, item or the owner's words). If several match, use the one the request means.
2. Explain the decision from the record: which check settled it, the rule that fired, and the AI review's summary. If the store's page tried to steer the agent, quote a few words of it.
3. If the owner asks whether money really moved, whether a refund or dispute is real, or wants proof, call verify_with_paypal with the purchase id and report what PayPal says.
4. If the owner wants to approve or decline a purchase that is waiting for them, call prepare_approval. It shows a cheque with buttons. You cannot approve or decline anything; say the owner must press the button.

## Rules
- Use only facts from tool results. Never invent amounts, ids or statuses.
- Dollars like $12.00. Plain words, 2 to 5 short sentences.
- Finish with complete_task; put your answer for the owner in the summary.`;

const RULES = `## Role
You are Chaperone's rules advisor. The owner asks what would happen under different spending rules. You answer by replaying their real purchase history with simulate_rules, which runs Chaperone's actual rules code. You never change the rules.

## How to work
1. Turn the question into changes: approvalThreshold (ask the owner first above $X), perPurchaseMax (block anything above $X), budgetLimit and budgetPeriod (the first budget, the food budget), blockStores, unblockStores, blockCategories, allowCategories (${CATEGORIES.join(", ")}).
2. Call simulate_rules once per alternative the owner wants to compare.
3. Answer in 2 to 4 sentences: how many past purchases would have gone differently, and which (store, amount, before and after). The AI review is not re-run; say so only if the result says "AI review decides".
4. Make clear nothing has changed; the owner can change rules on the Rules page.

## Rules
- Use only numbers from tool results.
- Finish with complete_task; put your answer for the owner in the summary.`;

const LEAD_EXTRA = `## Chaperone
This dashboard belongs to Maya. ShopBot is her AI shopping agent. Chaperone checks every purchase ShopBot tries to make (code limits, then an AI review, then Maya's signature for anything held) and gets money back through PayPal when a paid order goes wrong. The report has three pages: Overview, Tricks caught and Recovery.

### Chaperone's delegates
**Auditor (type: 'auditor')**: questions about specific purchases or stores: why one was approved, held or blocked; what a store's page told the agent; whether PayPal's own records agree ("did money really move?", "is that refund real?"); or when Maya wants to approve or decline a purchase that is waiting for her. The auditor can show her a cheque to sign. Neither you nor it can approve a payment.
**Rules (type: 'rules')**: what-if questions about her spending rules ("what if my food budget was $40?", "what if I blocked QuickGadgets?"). It replays past purchases and never changes rules.

Prefer the Auditor over Data for questions about one purchase or one store. Keep using Page and Widget for charts. Chaperone's own widget types are 'chaperone-money-flow' (a sankey of where money went) and 'chaperone-store-tricks' (what store pages told the agent). Relay the delegate's answer to Maya in your own words, briefly.`;

export const PROMPT_STARTERS: AgAiPromptStarter[] = [
  { label: "Why was it blocked?", prompt: "Why did Chaperone block the QuickGadgets order, and what did the store's page say?" },
  { label: "Check with PayPal", prompt: "Is the BrightHome refund real? Check it against PayPal's records." },
  { label: "What if", prompt: "What if my food budget were $15 a week? Which past purchases would have gone differently?" },
  { label: "Anything to sign?", prompt: "Is any purchase waiting for me to approve? Show it to me." },
  { label: "Money flow by store", prompt: "Add a money flow widget from each store to where the money is now." },
];

export function chaperoneHarness(api: AgStudioApi) {
  const t = chaperoneTools(api);
  return ({ builtIn }: AgAiHarnessBuilderContext): AgAiHarnessConfig => {
    const run = (def: AgAnyAiAgentDefinition) => directLlmRunner({ ...def, adapter: geminiAdapter });
    const auditor: AgAnyAiAgentDefinition = {
      id: "auditor",
      name: "Purchase auditor",
      description:
        "Answers questions about specific purchases: why Chaperone approved, held or blocked one, what the store's page told the agent, and whether PayPal's own records match. Can show a waiting purchase to the owner as a cheque to sign. Cannot move money.",
      schema: (s) => s.undefined(),
      instructions: () => AUDITOR,
      tools: () => [t.lookUp, t.verify, t.prepareApproval],
      maxTurns: 8,
    };
    const rules: AgAnyAiAgentDefinition = {
      id: "rules",
      name: "Rules advisor",
      description: "Answers what-if questions about the owner's spending rules by replaying every past purchase under changed limits. Never changes the rules.",
      schema: (s) => s.undefined(),
      instructions: () => RULES,
      tools: () => [t.simulate],
      maxTurns: 6,
    };
    const lead: AgAnyAiAgentDefinition = {
      ...builtIn.lead,
      tools: (ctx: AgAiAgentContext, params: unknown) => [
        ...(builtIn.lead.tools?.(ctx, params) ?? []).filter((tool) => tool.name !== "delegate_to"),
        ctx.tools.delegateTo(["data", "widget", "page", "planning", "auditor", "rules"]),
      ],
      instructions: (ctx: AgAiAgentContext, params: unknown) => `${builtIn.lead.instructions?.(ctx, params) ?? ""}\n\n${LEAD_EXTRA}`,
    };
    return {
      agents: [run(lead), run(builtIn.data), run(builtIn.widget), run(builtIn.page), run(builtIn.planning), run(auditor), run(rules)],
      primary: "lead",
      promptStarters: PROMPT_STARTERS,
    };
  };
}
