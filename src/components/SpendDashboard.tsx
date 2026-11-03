"use client";

import { AgStudioAiModule, AgStudioLicenseManager, createAiHarness, studioTheme, type AgFieldDefinition, type AgStudioApi } from "ag-studio";
import { AgStudio } from "ag-studio-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { BudgetRow, DecisionRow, ItemRow, PurchaseRow } from "@/lib/dashboard-data";
import { geminiAdapter } from "@/lib/studio-adapter";

const licenseKey = process.env.NEXT_PUBLIC_AG_STUDIO_LICENSE_KEY;
if (licenseKey) AgStudioLicenseManager.setLicenseKey(licenseKey);

// Chaperone's palette and type, so the dashboard reads as part of the product.
const themeParams = {
  fontFamily: "Plex, 'Segoe UI', system-ui, sans-serif",
  studioCanvasFontFamily: "Plex, 'Segoe UI', system-ui, sans-serif",
  foregroundColor: "#1b2333",
  textColor: "#1b2333",
  accentColor: "#1b2333",
  backgroundColor: "#ffffff",
  borderColor: "#d3d9e0",
  // The canvas is the page itself: no frame, no shadow, widgets sit on it like slips.
  studioCanvasBackgroundColor: "#e9edf1",
  studioWrapperBackgroundColor: "#e9edf1",
  studioWrapperBorder: false,
  studioCanvasBorder: false,
  studioCanvasShadow: "none",
  studioCanvasPadding: 0,
  studioWrapperSpacing: 0,
  studioCanvasRowHeight: 20,
  studioWidgetBackgroundColor: "#ffffff",
  studioWidgetBorder: "1px solid #d3d9e0",
  studioWidgetBorderRadius: 6,
  studioWidgetPadding: 16,
  studioWidgetTitleFontFamily: "Plex, 'Segoe UI', system-ui, sans-serif",
  studioWidgetTitleFontSize: 15,
  studioWidgetTitleFontWeight: 600,
  studioWidgetTitleTextColor: "#1b2333",
  studioWidgetSubtitleFontSize: 13,
  studioWidgetSubtitleFontWeight: 400,
  studioWidgetSubtitleTextColor: "#5b6475",
  studioValueWidgetFontSize: 30,
  chartFontFamily: "Plex, 'Segoe UI', system-ui, sans-serif",
  chartTextColor: "#1b2333",
  chartSubtleTextColor: "#5b6475",
  chartGridLineColor: "#e6eaef",
  chartAxisLineColor: "#d3d9e0",
  gridFontFamily: "Plex, 'Segoe UI', system-ui, sans-serif",
  gridFontSize: 13,
  gridHeaderBackgroundColor: "#f4f6f8",
  gridHeaderTextColor: "#5b6475",
  gridHeaderFontWeight: 600,
  gridOddRowBackgroundColor: "#fbfcfd",
  gridRowBorder: "1px solid #eceff3",
  gridColumnBorder: false,
  gridWrapperBorder: false,
  gridRowHeight: 38,
  gridCellHorizontalPadding: 10,
  // Chaperone's verdict colours first (the "decisions" table always lists Approved, Asked you, Blocked in that order), then quiet neutrals.
  chartPaletteFills1Color: "#1d7a4e",
  chartPaletteFills2Color: "#a9620a",
  chartPaletteFills3Color: "#c0352b",
  chartPaletteFills4Color: "#5b6475",
  chartPaletteFills5Color: "#8a94a6",
  chartPaletteStrokes1Color: "#1d7a4e",
  chartPaletteStrokes2Color: "#a9620a",
  chartPaletteStrokes3Color: "#c0352b",
  chartPaletteStrokes4Color: "#5b6475",
  chartPaletteStrokes5Color: "#8a94a6",
  studioPanelWidth: 230,
};
const desktopTheme = studioTheme.withParams({ ...themeParams, studioCanvasMinWidth: 560 });
const phoneTheme = studioTheme.withParams({ ...themeParams, studioCanvasMinWidth: 280, studioMinWidth: 280 });

type Layout = { pages?: { widgets?: Record<string, unknown>; widgetLayout?: Record<string, { xTrack: number; yTrack: number; xSpan: number; ySpan: number }> }[] };

// On a phone every widget gets the full width, stacked in reading order: the numbers, the verdicts, then the detail.
const PHONE_STACK: [string, number][] = [["spent", 6], ["safe", 6], ["checked", 6], ["budget", 6], ["calls", 15], ["byStore", 14], ["log", 22]];
function phoneLayout(state: unknown): unknown {
  const copy = structuredClone(state) as Layout;
  const page = copy?.pages?.[0];
  if (!page?.widgetLayout || !page.widgets) return state;
  const stacked: NonNullable<typeof page.widgetLayout> = {};
  let y = 0;
  for (const [id, height] of PHONE_STACK) {
    if (!page.widgets[id]) continue;
    stacked[id] = { xTrack: 0, yTrack: y, xSpan: 24, ySpan: height };
    y += height;
  }
  for (const [id, l] of Object.entries(page.widgetLayout)) {
    if (stacked[id]) continue;
    stacked[id] = { xTrack: 0, yTrack: y, xSpan: 24, ySpan: l.ySpan };
    y += l.ySpan;
  }
  page.widgetLayout = stacked;
  return copy;
}

/** Point the budget gauge at the owner's real limit (the saved layout says $60). */
function withBudget(state: unknown, budget?: BudgetRow): unknown {
  const copy = structuredClone(state) as Layout & { pages?: { widgets?: Record<string, { format?: { subtitle?: { text?: string }; style?: { scaleLabel?: { max?: number } } } }> }[] };
  const gauge = copy?.pages?.[0]?.widgets?.budget;
  if (!gauge || !budget) return state;
  if (gauge.format?.style?.scaleLabel) gauge.format.style.scaleLabel.max = budget.cap;
  if (gauge.format?.subtitle) gauge.format.subtitle.text = `Your rule: $${budget.cap} a ${budget.per}`;
  return copy;
}

const budgetFields: AgFieldDefinition[] = [
  { id: "budgetName", name: "Budget", format: "textFormat" },
  { id: "used", name: "Used", format: "currencyFormat", formatOptions: { format: new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }) } },
  { id: "cap", name: "Budget amount", format: "currencyFormat", formatOptions: { format: new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }) } },
  { id: "remaining", name: "Left", format: "currencyFormat", formatOptions: { format: new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }) } },
  { id: "per", name: "Period", format: "textFormat" },
];

const decisionFields: AgFieldDefinition[] = [
  { id: "decision", name: "Chaperone's call", format: "textFormat" },
  { id: "purchases", name: "Purchases", format: "integerFormat" },
  { id: "amount", name: "Amount", format: "currencyFormat", formatOptions: { format: new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }) } },
];

const modules = [AgStudioAiModule];
const panels = { edit: { left: [], right: ["ai", "edit", "data"] as ("ai" | "edit" | "data")[] } };

const money = { format: new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }) };
// "Nov 3, 1:42 PM": short enough for the grid's date column.
const when = { format: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) };

const purchaseFields: AgFieldDefinition[] = [
  { id: "date", name: "Date", format: "dateTimeFormat", formatOptions: when },
  { id: "merchant", name: "Store", format: "textFormat" },
  { id: "agent", name: "Agent", format: "textFormat" },
  { id: "request", name: "What you asked for", format: "textFormat" },
  { id: "items", name: "Items", format: "textFormat" },
  { id: "amount", name: "Order total", format: "currencyFormat", formatOptions: money },
  { id: "decision", name: "Chaperone's call", format: "textFormat" },
  { id: "status", name: "Status", format: "textFormat" },
  { id: "spent", name: "Money spent", format: "currencyFormat", formatOptions: money },
  { id: "keptSafe", name: "Money kept safe", format: "currencyFormat", formatOptions: money },
  { id: "aiVerdict", name: "AI review", format: "textFormat" },
  { id: "manipulation", name: "Manipulation", format: "textFormat" },
  { id: "reason", name: "Reason", format: "textFormat" },
  { id: "purchaseId", name: "Purchase ID", format: "textFormat", hide: true },
];

const itemFields: AgFieldDefinition[] = [
  { id: "date", name: "Date", format: "dateTimeFormat" },
  { id: "merchant", name: "Store", format: "textFormat" },
  { id: "item", name: "Item", format: "textFormat" },
  { id: "category", name: "Category", format: "textFormat" },
  { id: "amount", name: "Amount", format: "currencyFormat", formatOptions: money },
  { id: "status", name: "Status", format: "textFormat" },
  { id: "spent", name: "Money spent", format: "currencyFormat", formatOptions: money },
  { id: "purchaseId", name: "Purchase ID", format: "textFormat", hide: true },
];

const promptStarters = [
  { label: "Food this week", prompt: "Add a chart of how much my agent spent on groceries and food delivery, by day, for the last 7 days." },
  { label: "What got blocked", prompt: "Show me every purchase Chaperone blocked, with the store, amount and reason." },
  { label: "Money kept safe", prompt: "Add a big number showing the total money Chaperone kept safe, next to the total money spent." },
];

export default function SpendDashboard({
  purchases,
  items,
  decisions,
  budget,
  initialState,
}: {
  purchases: PurchaseRow[];
  items: ItemRow[];
  decisions: DecisionRow[];
  budget: BudgetRow[];
  initialState?: unknown;
}) {
  // This component only runs in the browser, so the screen width is known on the first render.
  const [phone] = useState(() => window.matchMedia("(max-width: 639px)").matches);
  const layout = useMemo(() => {
    if (!initialState) return initialState;
    const fitted = withBudget(initialState, budget[0]);
    return phone ? phoneLayout(fitted) : fitted;
  }, [phone, initialState, budget]);
  const period = useMemo(() => {
    const dates = purchases.map((p) => new Date(p.date).getTime()).sort((a, b) => a - b);
    if (!dates.length) return "";
    const day = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return dates.length > 1 && day(dates[0]) !== day(dates.at(-1)!) ? `${day(dates[0])} to ${day(dates.at(-1)!)}` : day(dates[0]);
  }, [purchases]);

  const data = useMemo(
    () => ({
      sources: [
        { id: "purchases", name: "Purchases", description: "One row per purchase your AI agent tried to make, with Chaperone's decision.", fields: purchaseFields, data: purchases.map((p) => ({ ...p, date: new Date(p.date) })) },
        { id: "items", name: "Items", description: "One row per item in those purchases.", fields: itemFields, data: items.map((i) => ({ ...i, date: new Date(i.date) })) },
        { id: "decisions", name: "Chaperone's calls", description: "How many purchases Chaperone approved, asked the owner about, or blocked.", fields: decisionFields, data: decisions },
        { id: "budgets", name: "Budget", description: "The owner's spending budget from their rules, and how much of it is used this period.", fields: budgetFields, data: budget },
      ],
    }),
    [purchases, items, decisions, budget],
  );

  // Owners see a clean dashboard; "Customize" opens the editor and the AI assistant.
  const [mode, setMode] = useState<"view" | "edit">("view");

  // AG Studio scrolls inside a fixed height. Measure what the widgets need and grow to fit,
  // so the dashboard reads like the rest of the page. Widgets the AI adds make it grow too.
  const box = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  useEffect(() => {
    const measure = () => {
      const layout = box.current?.querySelector<HTMLElement>(".ag-studio-layout");
      if (layout) setContentHeight((h) => (h === null || layout.scrollHeight > h + 4 ? layout.scrollHeight : h));
    };
    const timer = setInterval(measure, 400);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
        <p className="text-sm text-muted">
          {mode === "edit"
            ? "Drag widgets, or ask the AI assistant for a new chart."
            : `${period ? `Statement for ${period}. ` : ""}Live from Chaperone's purchase log.${phone ? " To customize it with AI, open this page on a larger screen." : ""}`}
        </p>
        {!phone && (
          <button
            onClick={() => setMode((m) => (m === "view" ? "edit" : "view"))}
            className="shrink-0 rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-paper hover:opacity-90"
          >
            {mode === "view" ? "Customize with AI" : "Done"}
          </button>
        )}
      </div>
      <div ref={box} className="overflow-x-clip" style={{ height: mode === "edit" ? 820 : contentHeight ? contentHeight + 16 : phone ? 1200 : 640 }}>
        <AgStudio
          theme={phone ? phoneTheme : desktopTheme}
          data={data}
          mode={mode}
          modules={modules}
          panels={panels}
          initialState={layout as never}
          loadThemeGoogleFonts={false}
          ai={({ api }: { api: AgStudioApi }) => createAiHarness(api, { adapter: geminiAdapter, primary: "lead", promptStarters })}
          onApiReady={(e) => {
            // Exposed so the default layout can be captured during development.
            (window as unknown as { chaperoneStudio?: AgStudioApi }).chaperoneStudio = e.api;
          }}
          style={{ height: "100%", width: "100%" }}
        />
      </div>
    </div>
  );
}
