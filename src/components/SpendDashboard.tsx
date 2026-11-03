"use client";

import { AgStudioAiModule, AgStudioLicenseManager, createAiHarness, studioTheme, type AgFieldDefinition, type AgStudioApi } from "ag-studio";
import { AgStudio } from "ag-studio-react";
import { useMemo, useState } from "react";
import type { ItemRow, PurchaseRow } from "@/lib/dashboard-data";
import { geminiAdapter } from "@/lib/studio-adapter";

const licenseKey = process.env.NEXT_PUBLIC_AG_STUDIO_LICENSE_KEY;
if (licenseKey) AgStudioLicenseManager.setLicenseKey(licenseKey);

// Chaperone's palette and type, so the dashboard reads as part of the product.
const theme = studioTheme.withParams({
  fontFamily: "Plex, 'Segoe UI', system-ui, sans-serif",
  studioCanvasFontFamily: "Plex, 'Segoe UI', system-ui, sans-serif",
  foregroundColor: "#1b2333",
  textColor: "#1b2333",
  accentColor: "#1b2333",
  backgroundColor: "#ffffff",
  studioCanvasBackgroundColor: "#e9edf1",
  borderColor: "#d3d9e0",
  // Chaperone's verdict colours first (Approved, Asked you, Blocked sort in that order), then quiet neutrals.
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
  studioCanvasMinWidth: 560,
});

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

export default function SpendDashboard({ purchases, items, initialState }: { purchases: PurchaseRow[]; items: ItemRow[]; initialState?: unknown }) {
  const data = useMemo(
    () => ({
      sources: [
        { id: "purchases", name: "Purchases", description: "One row per purchase your AI agent tried to make, with Chaperone's decision.", fields: purchaseFields, data: purchases.map((p) => ({ ...p, date: new Date(p.date) })) },
        { id: "items", name: "Items", description: "One row per item in those purchases.", fields: itemFields, data: items.map((i) => ({ ...i, date: new Date(i.date) })) },
      ],
    }),
    [purchases, items],
  );

  // Owners see a clean dashboard; "Customize" opens the editor and the AI assistant.
  const [mode, setMode] = useState<"view" | "edit">("view");

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2">
        <p className="text-sm text-muted">{mode === "view" ? "Live from your purchase log." : "Drag widgets, or ask the AI assistant for a new chart."}</p>
        <button
          onClick={() => setMode((m) => (m === "view" ? "edit" : "view"))}
          className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-paper hover:opacity-90"
        >
          {mode === "view" ? "Customize with AI" : "Done"}
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <AgStudio
          theme={theme}
          data={data}
          mode={mode}
          modules={modules}
          panels={panels}
          initialState={initialState as never}
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
