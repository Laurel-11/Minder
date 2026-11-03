"use client";

import { AgStudioAiModule, AgStudioLicenseManager, createAiHarness, studioTheme, type AgFieldDefinition, type AgStudioApi } from "ag-studio";
import { AgStudio } from "ag-studio-react";
import { useMemo, useState } from "react";
import type { DecisionRow, ItemRow, PurchaseRow } from "@/lib/dashboard-data";
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
  studioCanvasBackgroundColor: "#e9edf1",
  borderColor: "#d3d9e0",
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
const phoneTheme = studioTheme.withParams({ ...themeParams, studioCanvasMinWidth: 280 });

type Layout = { pages?: { widgets?: Record<string, unknown>; widgetLayout?: Record<string, { xTrack: number; yTrack: number; xSpan: number; ySpan: number }> }[] };

// On a phone every widget gets the full width, stacked in reading order: the numbers, the verdicts, then the detail.
const PHONE_STACK: [string, number][] = [["spent", 6], ["safe", 6], ["checked", 6], ["calls", 15], ["byCategory", 15], ["log", 24]];
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

const decisionFields: AgFieldDefinition[] = [
  { id: "decision", name: "Chaperone's call", format: "textFormat" },
  { id: "purchases", name: "Purchases", format: "integerFormat" },
  { id: "amount", name: "Amount", format: "currencyFormat", formatOptions: { format: new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }) } },
];

const modules = [AgStudioAiModule];
const panels = { edit: { left: [], right: ["ai", "edit", "data"] as ("ai" | "edit" | "data")[] } };

const money = { format: new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }) };

const purchaseFields: AgFieldDefinition[] = [
  { id: "date", name: "Date", format: "dateTimeFormat" },
  { id: "merchant", name: "Store", format: "textFormat" },
  { id: "agent", name: "Agent", format: "textFormat" },
  { id: "request", name: "What you asked for", format: "textFormat" },
  { id: "items", name: "Items", format: "textFormat" },
  { id: "amount", name: "Amount", format: "currencyFormat", formatOptions: money },
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
  initialState,
}: {
  purchases: PurchaseRow[];
  items: ItemRow[];
  decisions: DecisionRow[];
  initialState?: unknown;
}) {
  // This component only runs in the browser, so the screen width is known on the first render.
  const [phone] = useState(() => window.matchMedia("(max-width: 639px)").matches);
  const layout = useMemo(() => (phone && initialState ? phoneLayout(initialState) : initialState), [phone, initialState]);

  const data = useMemo(
    () => ({
      sources: [
        { id: "purchases", name: "Purchases", description: "One row per purchase your AI agent tried to make, with Chaperone's decision.", fields: purchaseFields, data: purchases.map((p) => ({ ...p, date: new Date(p.date) })) },
        { id: "items", name: "Items", description: "One row per item in those purchases.", fields: itemFields, data: items.map((i) => ({ ...i, date: new Date(i.date) })) },
        { id: "decisions", name: "Chaperone's calls", description: "How many purchases Chaperone approved, asked the owner about, or blocked.", fields: decisionFields, data: decisions },
      ],
    }),
    [purchases, items, decisions],
  );

  // Owners see a clean dashboard; "Customize" opens the editor and the AI assistant.
  const [mode, setMode] = useState<"view" | "edit">("view");

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2">
        <p className="text-sm text-muted">
          {phone ? "Live from your purchase log. To customize it with AI, open this page on a larger screen." : mode === "view" ? "Live from your purchase log." : "Drag widgets, or ask the AI assistant for a new chart."}
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
      <div className="min-h-0 flex-1">
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
