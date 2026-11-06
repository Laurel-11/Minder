// Minder's own AG Studio widget types, registered next to Studio's built-in ones. They show up
// in the widget menu under "Minder", and the AI agents can add and configure them like any other.
import type { AgFormatShapeParams, AgShapeBuilder, AgWidgetFormParams, AgWidgetsConfig } from "ag-studio";
import { createWidgets } from "ag-studio-react";
import ChequesWidget from "./ChequesWidget";
import MoneyFlowWidget from "./MoneyFlowWidget";
import StoreTricksWidget from "./StoreTricksWidget";

export const MONEY_FLOW = "minder-money-flow";
export const STORE_TRICKS = "minder-store-tricks";
export const CHEQUES = "minder-cheques";

type StyleBuilder = (s: AgShapeBuilder) => ReturnType<AgShapeBuilder["object"]>;

/** The widget's `format` shape: titles like every other widget, plus our own style options. Studio validates AI edits against it. */
const formatShapeWith =
  (style: StyleBuilder) =>
  ({ api }: AgFormatShapeParams) => {
    const command = api.defineAiCommand((s: AgShapeBuilder) => {
      const title = (what: string) =>
        s
          .object(
            {
              enabled: s.boolean({ description: `Whether to show the ${what}. When true, also set text.` }).optional(),
              text: s.string({ description: "The display text." }).optional(),
              color: s.string({ description: "Text colour as a CSS colour string." }).optional(),
              textAlign: s.enum(["left", "center", "right"], { description: "Horizontal alignment." }).optional(),
              wrapping: s.boolean({ description: "Wrap long text instead of truncating it." }).optional(),
            },
            { description: `The widget ${what}.` },
          )
          .optional();
      return {
        input: s
          .object(
            {
              title: title("title"),
              subtitle: title("subtitle"),
              caption: title("caption"),
              crossFilter: s.enum(["filter", "none"], { description: '"filter" (default) narrows this widget when another widget is clicked; "none" ignores clicks elsewhere.' }).optional(),
              style: style(s).optional(),
            },
            { description: "Visual formatting. Only set what the user asks for." },
          )
          .optional(),
        execute: () => ({ success: true as const, value: undefined }),
      };
    });
    return command.shape;
  };

const FLOW_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="none" viewBox="0 0 32 32"><rect x="2" y="4" width="4" height="24" rx="1" fill="var(--ag-chart-palette-fills-4-color, #5b6475)"/><rect x="26" y="4" width="4" height="10" rx="1" fill="var(--ag-chart-palette-fills-1-color, #1d7a4e)"/><rect x="26" y="17" width="4" height="11" rx="1" fill="var(--ag-chart-palette-fills-4-color, #5b6475)"/><path d="M6 4C16 4 16 4 26 4V14C16 14 16 16 6 16Z" fill="var(--ag-chart-palette-fills-1-color, #1d7a4e)" fill-opacity=".45"/><path d="M6 16C16 16 16 17 26 17V28C16 28 16 28 6 28Z" fill="var(--ag-chart-palette-fills-4-color, #5b6475)" fill-opacity=".45"/></svg>';
const QUOTE_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="none" viewBox="0 0 32 32"><rect x="2" y="5" width="28" height="22" rx="3" stroke="var(--ag-chart-palette-fills-4-color, #5b6475)" stroke-width="2"/><path d="M8 13h4v4c0 2-1 3-3 3" stroke="var(--ag-chart-palette-fills-3-color, #c0352b)" stroke-width="2"/><path d="M16 13h4v4c0 2-1 3-3 3" stroke="var(--ag-chart-palette-fills-3-color, #c0352b)" stroke-width="2"/><path d="M23 21l4 2" stroke="var(--ag-chart-palette-fills-3-color, #c0352b)" stroke-width="2"/></svg>';

const moneyFlow = {
  id: MONEY_FLOW,
  label: "Money flow",
  icon: FLOW_ICON,
  dataMapping: {
    stages: {
      type: "fieldset",
      supportedRoles: ["category"],
      requires: { cardinality: "many" },
      required: true,
      intent: "category",
      aiDescription:
        "Ordered stages the money passes through, left to right (2 to 5 fields from one table). Minder's story is flows.askedToPay, flows.whichCheck, flows.atCheckout, flows.whereNow.",
    },
    value: {
      type: "field",
      supportedRoles: ["numeric"],
      requires: { per: "dataMapping.stages", cardinality: "one" },
      required: true,
      intent: "value",
      aiDescription: "The money that sizes each ribbon, normally flows.amount (sum).",
    },
  },
  formatShape: formatShapeWith((s) =>
    s.object({
      showAmounts: s.boolean({ description: "Show the dollar amount next to each block. Default true." }).optional(),
      showStageNames: s.boolean({ description: "Show each stage's name above its column. Default true." }).optional(),
    }),
  ),
  form: (p: AgWidgetFormParams) =>
    p.createDefaults({
      dataMappingItems: [
        { key: "stages", label: "Stages, in order" },
        { key: "value", label: "Amount" },
      ],
    }),
  defaultState: {
    format: { title: { enabled: true, text: "Where the money went" }, subtitle: { enabled: true, text: "Every dollar ShopBot asked to spend, through Minder's checks" } },
    dataMapping: {
      stages: [{ id: "flows.askedToPay" }, { id: "flows.whichCheck" }, { id: "flows.atCheckout" }, { id: "flows.whereNow" }],
      value: [{ id: "flows.amount", aggregation: "sum" }],
    },
  },
  comp: MoneyFlowWidget,
  defaultSize: { width: 900, height: 360 },
  minSize: { width: 280, height: 220 },
  featureConfig: { crossFilter: { supportsHighlight: false } },
  ai: {
    label: "Money flow (sankey)",
    description:
      "Minder's own widget: a sankey diagram of where money went, stage by stage. Ribbons are coloured by where the money ended up (green stayed with the owner, amber is waiting, slate reached a store). Clicking a block filters the dashboard.",
    usage:
      "Use it to show how money moved through Minder's checks: how much was blocked by code limits or the AI review, held for the owner's signature, paid, refunded, or disputed. Prefer it over a bar chart whenever the question is 'where did the money go'.",
    configuration:
      "Map stages to 2-5 category fields from the flows table in order, e.g. flows.askedToPay, flows.whichCheck, flows.atCheckout, flows.whereNow; or flows.merchant then flows.whereNow for a per-store view. Map value to flows.amount with sum.",
  },
};

const storeTricks = {
  id: STORE_TRICKS,
  label: "What stores told your agent",
  icon: QUOTE_ICON,
  dataMapping: {
    quote: { type: "field", supportedRoles: ["category"], required: true, intent: "category", aiDescription: "The words the store's page aimed at AI agents: tricks.quote." },
    store: { type: "field", supportedRoles: ["category"], intent: "category", aiDescription: "The store: tricks.merchant. Clicking a quote filters the dashboard to that store." },
    outcome: { type: "field", supportedRoles: ["category"], intent: "category", aiDescription: "What Minder did about it: tricks.outcome. Shown as a stamp." },
    amount: {
      type: "field",
      supportedRoles: ["numeric"],
      requires: { per: "dataMapping.quote", cardinality: "one" },
      intent: "value",
      aiDescription: "The order total: tricks.amount (sum).",
    },
  },
  formatShape: formatShapeWith((s) => s.object({ showAmounts: s.boolean({ description: "Show each order's total. Default true." }).optional() })),
  form: (p: AgWidgetFormParams) =>
    p.createDefaults({
      dataMappingItems: [
        { key: "quote", label: "What the store said" },
        { key: "store", label: "Store" },
        { key: "outcome", label: "Outcome" },
        { key: "amount", label: "Order total" },
      ],
    }),
  defaultState: {
    format: { title: { enabled: true, text: "What stores told your agent" }, subtitle: { enabled: true, text: "Hidden on their pages, caught by the AI review" } },
    dataMapping: {
      quote: [{ id: "tricks.quote" }],
      store: [{ id: "tricks.merchant" }],
      outcome: [{ id: "tricks.outcome" }],
      amount: [{ id: "tricks.amount", aggregation: "sum" }],
    },
  },
  comp: StoreTricksWidget,
  defaultSize: { width: 600, height: 420 },
  minSize: { width: 260, height: 200 },
  featureConfig: { crossFilter: { supportsHighlight: false } },
  ai: {
    label: "What stores told your agent (quote wall)",
    description: "Minder's own widget: the exact text store pages hid for AI shopping agents, each stamped with what Minder did. Clicking a quote filters the dashboard to that store.",
    usage: "Use it to show prompt-injection or manipulation attempts by stores, in their own words. Use the tricks table.",
    configuration: "Map quote to tricks.quote, store to tricks.merchant, outcome to tricks.outcome and amount to tricks.amount (sum).",
  },
};

const CHEQUE_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="none" viewBox="0 0 32 32"><rect x="2" y="7" width="28" height="18" rx="2" stroke="var(--ag-chart-palette-fills-4-color, #5b6475)" stroke-width="2"/><path d="M7 13h9M7 17h6" stroke="var(--ag-chart-palette-fills-4-color, #5b6475)" stroke-width="2"/><path d="M18 20c2-3 3 1 5-2s2 1 4-1" stroke="var(--ag-chart-palette-fills-2-color, #a9620a)" stroke-width="2"/></svg>';

const cheques = {
  id: CHEQUES,
  label: "Waiting for your signature",
  icon: CHEQUE_ICON,
  dataMapping: {
    purchase: { type: "field", supportedRoles: ["category"], required: true, intent: "category", aiDescription: "The purchase id: purchases.purchaseId." },
    status: {
      type: "field",
      supportedRoles: ["category"],
      required: true,
      intent: "category",
      aiDescription: "The purchase status: purchases.status. Purchases whose status is 'Waiting for you' are drawn as cheques.",
    },
  },
  formatShape: formatShapeWith((s) => s.object({})),
  form: (p: AgWidgetFormParams) =>
    p.createDefaults({
      dataMappingItems: [
        { key: "purchase", label: "Purchase" },
        { key: "status", label: "Status" },
      ],
    }),
  defaultState: {
    format: { title: { enabled: true, text: "Waiting for your signature" }, subtitle: { enabled: true, text: "PayPal holds the money until you decide" } },
    dataMapping: { purchase: [{ id: "purchases.purchaseId" }], status: [{ id: "purchases.status" }] },
  },
  comp: ChequesWidget,
  defaultSize: { width: 380, height: 340 },
  minSize: { width: 280, height: 220 },
  ai: {
    label: "Waiting for your signature (cheques)",
    description:
      "Minder's own widget: every purchase PayPal is holding for the owner, drawn as a cheque with 'Sign and pay' and 'Decline' buttons. Only the owner's click moves money; the widget never decides by itself.",
    usage: "Use it when the owner wants to see or act on purchases that are waiting for them. It shows a short note when nothing is waiting.",
    configuration: "Map purchase to purchases.purchaseId and status to purchases.status.",
  },
};

/** Studio's widgets plus Minder's three, with ours first in the menu. */
export function minderWidgets(defaults: AgWidgetsConfig): AgWidgetsConfig {
  return createWidgets({
    additionalTypes: [moneyFlow, storeTricks, cheques],
    menu: [{ label: "Minder", widgetIds: [MONEY_FLOW, STORE_TRICKS, CHEQUES] }, ...defaults.menu],
  } as never) as unknown as AgWidgetsConfig;
}
