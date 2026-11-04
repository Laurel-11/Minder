"use client";

import { AgStudioAiModule, createAiHarness, type AgReportState, type AgStudioApi } from "ag-studio";
import { AgStudio, AgStudioProvider } from "ag-studio-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { BudgetRow, DashboardRows } from "@/lib/dashboard-data";
import { CHEQUE_EVENT, chaperoneHarness } from "./studio/agents";
import { buildStudioData } from "./studio/data";
import { desktopTheme, phoneTheme } from "./studio/theme";
import { ApprovalCheque, Cheque, PayPalCheckCard, PurchaseFoundCard, WhatIfCard } from "./studio/ToolCards";
import type { PurchaseRecord } from "@/lib/studio-tools";
import { chaperoneWidgets, MONEY_FLOW, STORE_TRICKS } from "./studio/widgets";

const licenseKey = process.env.NEXT_PUBLIC_AG_STUDIO_LICENSE_KEY;

type Track = { xTrack: number; yTrack: number; xSpan: number; ySpan: number };
type PageLayout = { id: string; widgets?: Record<string, { type?: string; format?: Record<string, unknown> }>; widgetLayout?: Record<string, Track> };
type Layout = { pages?: PageLayout[]; selectedPageId?: string };

// The report's pages, as the owner would name them. Pages the AI adds get a plain number.
const PAGE_TITLES: Record<string, string> = { "page-1": "Overview", tricks: "Tricks caught", recovery: "Recovery" };

// On a phone every widget gets the full width, stacked in reading order, at a height that suits its type.
const PHONE_HEIGHT: Record<string, number> = {
  value: 6,
  "linear-gauge": 6,
  "donut-chart": 15,
  "bar-chart-grouped": 14,
  grid: 22,
  [MONEY_FLOW]: 24,
  [STORE_TRICKS]: 30,
};
function phoneLayout(state: unknown): unknown {
  const copy = structuredClone(state) as Layout;
  for (const page of copy?.pages ?? []) {
    if (!page.widgetLayout || !page.widgets) continue;
    const order = Object.entries(page.widgetLayout).sort(([, a], [, b]) => a.yTrack - b.yTrack || a.xTrack - b.xTrack);
    const stacked: Record<string, Track> = {};
    let y = 0;
    for (const [id, l] of order) {
      const h = PHONE_HEIGHT[page.widgets[id]?.type ?? ""] ?? l.ySpan;
      stacked[id] = { xTrack: 0, yTrack: y, xSpan: 24, ySpan: h };
      y += h;
    }
    page.widgetLayout = stacked;
  }
  return copy;
}

/** Point the budget gauge at the owner's real limit (the saved layout says $60). */
function withBudget(state: unknown, budget?: BudgetRow): unknown {
  const copy = structuredClone(state) as Layout;
  const gauge = copy?.pages?.flatMap((p) => Object.values(p.widgets ?? {})).find((w) => w.type === "linear-gauge") as
    | { format?: { subtitle?: { text?: string }; style?: { scaleLabel?: { max?: number } } } }
    | undefined;
  if (!gauge || !budget) return state;
  if (gauge.format?.style?.scaleLabel) gauge.format.style.scaleLabel.max = budget.cap;
  if (gauge.format?.subtitle) gauge.format.subtitle.text = `Your rule: $${budget.cap} a ${budget.per}`;
  return copy;
}

const modules = [AgStudioAiModule];
const panels = { edit: { left: [], right: ["ai", "edit", "data"] as ("ai" | "edit" | "data")[] } };

// How our agents' tool calls read in the chat panel. The wording describes the work; the cards show the result.
const aiToolDisplay = {
  look_up_purchase: {
    label: ({ args }: { args: { query?: string } }) => ({ text: `Looked up ${args.query ? `"${args.query}"` : "a purchase"} in Chaperone's log` }),
    detail: PurchaseFoundCard,
  },
  verify_with_paypal: {
    label: ({ result }: { result?: { success: boolean; data?: unknown } }) => {
      const v = result?.success ? (result.data as { allMatch?: boolean; checks?: unknown[] } | undefined) : undefined;
      return { text: "Checked PayPal's own records", pill: v ? (v.allMatch ? "Matches" : "Mismatch") : undefined };
    },
    detail: PayPalCheckCard,
  },
  prepare_approval: { label: () => ({ text: "Prepared a cheque for you to sign" }), detail: ApprovalCheque },
  simulate_rules: {
    label: ({ result }: { result?: { success: boolean; data?: unknown } }) => {
      const w = result?.success ? (result.data as { changedCount?: number } | undefined) : undefined;
      return { text: "Replayed past purchases under the new rules", pill: w ? `${w.changedCount} changed` : undefined };
    },
    detail: WhatIfCard,
  },
};

export default function SpendDashboard({ rows, initialState }: { rows: DashboardRows; initialState?: unknown }) {
  // This component only runs in the browser, so the screen width is known on the first render.
  const [phone] = useState(() => window.matchMedia("(max-width: 639px)").matches);
  const layout = useMemo(() => {
    if (!initialState) return initialState;
    const fitted = withBudget(initialState, rows.budget[0]);
    return phone ? phoneLayout(fitted) : fitted;
  }, [phone, initialState, rows.budget]);
  const period = useMemo(() => {
    const dates = rows.purchases.map((p) => new Date(p.date).getTime()).sort((a, b) => a - b);
    if (!dates.length) return "";
    const day = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return dates.length > 1 && day(dates[0]) !== day(dates.at(-1)!) ? `${day(dates[0])} to ${day(dates.at(-1)!)}` : day(dates[0]);
  }, [rows.purchases]);

  const data = useMemo(() => buildStudioData(rows), [rows]);
  const api = useRef<AgStudioApi | null>(null);

  // Owners see a clean dashboard; "Customize" opens the editor and the AI assistant.
  const [mode, setMode] = useState<"view" | "edit">("view");
  // The first time the editor opens, fold the Compose and Data panels so the report keeps room next
  // to the AI assistant. (Studio builds its panels on entering edit mode, so this cannot live in the saved layout.)
  const tidied = useRef(false);
  useEffect(() => {
    if (mode !== "edit" || tidied.current) return;
    const timer = setTimeout(() => {
      const studio = api.current;
      if (!studio) return;
      tidied.current = true;
      studio.setState({ ...studio.getState(), panels: { edit: { collapsed: true }, data: { collapsed: true } } });
    }, 300);
    return () => clearTimeout(timer);
  }, [mode]);

  // Which page is showing. Studio owns the state; we mirror it so our tabs stay in step with
  // pages the AI adds or switches to.
  const [pages, setPages] = useState<string[]>(() => ((initialState as Layout)?.pages ?? []).map((p) => p.id));
  const [pageId, setPageId] = useState<string>(() => (initialState as Layout)?.selectedPageId ?? "page-1");
  const showPage = (id: string) => {
    const studio = api.current;
    if (!studio || id === pageId) return;
    studio.setState({ ...studio.getState(), selectedPageId: id });
    setPageId(id);
    setContentHeight(null);
  };
  const counts: Record<string, string> = {
    tricks: rows.tricks.length ? String(rows.tricks.length) : "",
    recovery: rows.cases.length ? String(rows.cases.length) : "",
  };

  // A cheque the auditor agent prepared: shown above the report until the owner signs, declines or closes it.
  const [cheque, setCheque] = useState<PurchaseRecord | null>(null);
  useEffect(() => {
    const show = (e: Event) => setCheque((e as CustomEvent<PurchaseRecord>).detail);
    window.addEventListener(CHEQUE_EVENT, show);
    return () => window.removeEventListener(CHEQUE_EVENT, show);
  }, []);

  // AG Studio scrolls inside a fixed height. Measure what the widgets need and grow to fit, so the
  // dashboard reads like the rest of the page. Widgets the AI adds make it grow too.
  const box = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  useEffect(() => {
    const measure = () => {
      const el = box.current?.querySelector<HTMLElement>(".ag-studio-layout");
      if (el) setContentHeight((h) => (h === null || el.scrollHeight > h + 4 ? el.scrollHeight : h));
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
      {pages.length > 1 && (
        <div role="tablist" aria-label="Dashboard pages" className="mb-4 flex flex-wrap gap-x-6 border-b border-line">
          {pages.map((id, i) => (
            <button
              key={id}
              role="tab"
              aria-selected={id === pageId}
              onClick={() => showPage(id)}
              className="-mb-px flex items-baseline gap-1.5 border-b-2 border-transparent px-0.5 pb-2 text-[15px] text-muted hover:text-ink aria-selected:border-ink aria-selected:font-semibold aria-selected:text-ink"
            >
              {PAGE_TITLES[id] ?? `Page ${i + 1}`}
              {counts[id] && <span className="text-[13px] font-normal text-muted tabular-nums">{counts[id]}</span>}
            </button>
          ))}
        </div>
      )}
      {cheque && (
        <section aria-label="Waiting for your signature" className="mb-4 flex flex-col gap-2 rounded-lg border border-hold bg-hold-soft p-3 sm:max-w-md">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-[15px] font-semibold">ShopBot wants to pay. Nothing moves until you decide.</h2>
            <button type="button" onClick={() => setCheque(null)} className="shrink-0 text-sm text-muted underline hover:text-ink">
              Close
            </button>
          </div>
          <Cheque key={cheque.purchaseId} purchase={cheque} />
        </section>
      )}
      <div ref={box} className="overflow-x-clip" style={{ height: mode === "edit" ? 820 : contentHeight ? contentHeight + 16 : phone ? 1200 : 640 }}>
        <AgStudioProvider licenseKey={licenseKey}>
          <AgStudio
            theme={phone ? phoneTheme : desktopTheme}
            data={data}
            widgets={chaperoneWidgets as never}
            mode={mode}
            modules={modules}
            panels={panels}
            initialState={layout as never}
            loadThemeGoogleFonts={false}
            ai={({ api: studio }: { api: AgStudioApi }) => createAiHarness(studio, chaperoneHarness(studio))}
            aiToolDisplay={aiToolDisplay as never}
            onApiReady={(e) => {
              api.current = e.api;
              // Exposed so the default layout can be captured during development.
              (window as unknown as { chaperoneStudio?: AgStudioApi }).chaperoneStudio = e.api;
            }}
            onStateUpdated={(e: { state: AgReportState }) => {
              setPages(e.state.pages.map((p) => p.id));
              setPageId((current) => {
                if (current !== e.state.selectedPageId) setContentHeight(null);
                return e.state.selectedPageId;
              });
            }}
            style={{ height: "100%", width: "100%" }}
          />
        </AgStudioProvider>
      </div>
    </div>
  );
}
