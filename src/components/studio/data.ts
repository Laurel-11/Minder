// AG Studio's data model for the dashboard: one table per row type in lib/dashboard-data.ts, the
// relationships that tie every table back to its purchase (so a click in one widget filters the
// others), a shared calendar, and a calculated measure.
import type { AgDataSourcesDefinition, AgExpressionFieldDefinition, AgFieldDefinition, AgRelationDefinition } from "ag-studio";
import type { DashboardRows } from "@/lib/dashboard-data";

const money = { format: new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }) };
// "Nov 3, 1:42 PM": short enough for a grid's date column.
const when = { format: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) };

const text = (id: string, name: string, description?: string): AgFieldDefinition => ({ id, name, format: "textFormat", ...(description && { description }) });
const usd = (id: string, name: string, description?: string): AgFieldDefinition => ({ id, name, format: "currencyFormat", formatOptions: money, ...(description && { description }) });
const date = (id: string, name: string): AgFieldDefinition => ({ id, name, format: "dateTimeFormat", formatOptions: when });
const key = (id: string, name: string): AgFieldDefinition => ({ id, name, format: "textFormat", hide: true });

const purchaseFields: AgFieldDefinition[] = [
  date("date", "Date"),
  text("merchant", "Store"),
  text("agent", "Agent"),
  text("request", "What you asked for", "The owner's own words to ShopBot."),
  text("items", "Items"),
  usd("amount", "Order total"),
  text("decision", "Minder's call", "Approved, Asked you, or Blocked."),
  text("status", "Status"),
  text("whichCheck", "Which check", "The layer that settled it: Code limits, AI review, Your signature, or Passed every check."),
  text("atCheckout", "At checkout", "Paid, Blocked, Declined, Waiting for you, or Payment failed."),
  usd("spent", "Money spent", "Money that actually moved through PayPal."),
  usd("keptSafe", "Money kept safe", "Orders Minder blocked or the owner declined: never paid."),
  usd("refunded", "Refunded", "Money recovered afterwards through a PayPal refund."),
  text("aiVerdict", "AI review"),
  text("manipulation", "Manipulation", "Whether the AI review found the store's page steering the agent."),
  text("evidence", "What the store said", "The words on the store's page that tried to steer the agent."),
  text("reason", "Reason"),
  key("purchaseId", "Purchase ID"),
];

const itemFields: AgFieldDefinition[] = [
  date("date", "Date"),
  text("merchant", "Store"),
  text("item", "Item"),
  text("category", "Category"),
  usd("amount", "Amount"),
  text("status", "Status"),
  usd("spent", "Money spent"),
  key("purchaseId", "Purchase ID"),
];

const decisionFields: AgFieldDefinition[] = [
  text("decision", "Minder's call"),
  { id: "purchases", name: "Purchases", format: "integerFormat" },
  usd("amount", "Amount"),
];

const budgetFields: AgFieldDefinition[] = [
  text("budgetName", "Budget"),
  usd("used", "Used"),
  usd("cap", "Budget amount"),
  usd("remaining", "Left"),
  text("per", "Period"),
];

const flowFields: AgFieldDefinition[] = [
  text("askedToPay", "Asked to pay", "Always 'ShopBot asked to pay': where every dollar starts."),
  text("whichCheck", "Which check", "The layer that settled it: Code limits, AI review, Your signature, or Passed every check."),
  text("atCheckout", "At checkout", "Paid, Blocked, Declined, Waiting for you, or Payment failed."),
  text("whereNow", "Where it is now", "Never left you, Held in PayPal, In a PayPal dispute, Refunded to you, or With the store."),
  text("merchant", "Store"),
  usd("amount", "Amount"),
  key("purchaseId", "Purchase ID"),
];

const trickFields: AgFieldDefinition[] = [
  date("date", "Date"),
  text("merchant", "Store"),
  text("quote", "What the store told the agent", "Text hidden on the store's page, aimed at AI shopping agents."),
  text("aiNote", "What the AI review saw"),
  usd("amount", "Order total"),
  usd("paid", "Paid to the store"),
  text("outcome", "Outcome"),
  key("purchaseId", "Purchase ID"),
];

const caseFields: AgFieldDefinition[] = [
  date("date", "Opened"),
  text("merchant", "Store"),
  text("problem", "Problem"),
  text("openedBy", "Opened by"),
  text("status", "Case status"),
  text("storeOffered", "Store offered"),
  usd("recovered", "Recovered"),
  usd("amount", "Order total"),
  text("disputeId", "PayPal dispute"),
  text("disputeStatus", "Dispute status"),
  key("caseId", "Case ID"),
  key("purchaseId", "Purchase ID"),
];

const caseStepFields: AgFieldDefinition[] = [
  date("date", "When"),
  text("merchant", "Store"),
  text("who", "Who"),
  text("step", "What happened"),
  { id: "seq", name: "Step", format: "integerFormat", description: "Order of the step across all cases." },
  key("caseId", "Case ID"),
  key("purchaseId", "Purchase ID"),
];

// Foreign key 'table.field' -> primary key 'table.field'.
const manyToOne = (id: string, source: string, target: string): AgRelationDefinition => {
  const [sourceTable, sourceField] = source.split(".");
  const [targetTable, targetField] = target.split(".");
  return { id, source: { tableId: sourceTable, fieldId: sourceField }, target: { tableId: targetTable, fieldId: targetField }, type: "many-to-one" };
};

const keptSafeShare: AgExpressionFieldDefinition = {
  id: "keptSafeShare",
  name: "Share kept safe",
  description: "Money kept safe divided by everything ShopBot asked to pay.",
  format: "percentageFormat",
  isMeasure: true,
  expression: { operator: "divide", inputs: [{ id: "purchases.keptSafe", aggregation: "sum" }, { id: "purchases.amount", aggregation: "sum" }] },
};

const asDates = <T extends { date: string }>(rows: T[]) => rows.map((r) => ({ ...r, date: new Date(r.date) }));

export function buildStudioData(rows: DashboardRows): AgDataSourcesDefinition {
  return {
    sources: [
      { id: "purchases", name: "Purchases", description: "One row per purchase ShopBot tried to make, with Minder's decision.", fields: purchaseFields, data: asDates(rows.purchases) },
      { id: "items", name: "Items", description: "One row per item in those purchases.", fields: itemFields, data: asDates(rows.items) },
      { id: "decisions", name: "Minder's calls", description: "How many purchases Minder approved, asked the owner about, or blocked.", fields: decisionFields, data: rows.decisions },
      { id: "budgets", name: "Budget", description: "The owner's spending budget from their rules, and how much of it is used this period.", fields: budgetFields, data: rows.budget },
      {
        id: "flows",
        name: "Money flow",
        description: "Where every dollar ShopBot asked to spend went: the check that settled it, what happened at checkout, and where the money is now. A partly refunded purchase has two rows.",
        fields: flowFields,
        data: rows.flows,
      },
      { id: "tricks", name: "Store tricks", description: "Store pages the AI review caught steering ShopBot, with the words they used.", fields: trickFields, data: asDates(rows.tricks) },
      { id: "cases", name: "Recovery cases", description: "Paid orders that went wrong afterwards, and how Minder and PayPal got the money back.", fields: caseFields, data: asDates(rows.cases) },
      { id: "caseSteps", name: "Case steps", description: "Every step of every recovery case, in order: who did what, and when.", fields: caseStepFields, data: asDates(rows.caseSteps) },
    ],
    relationships: [
      manyToOne("item-purchase", "items.purchaseId", "purchases.purchaseId"),
      manyToOne("flow-purchase", "flows.purchaseId", "purchases.purchaseId"),
      manyToOne("trick-purchase", "tricks.purchaseId", "purchases.purchaseId"),
      manyToOne("case-purchase", "cases.purchaseId", "purchases.purchaseId"),
      manyToOne("step-case", "caseSteps.caseId", "cases.caseId"),
    ],
    expressions: [keptSafeShare],
  } as AgDataSourcesDefinition;
}
