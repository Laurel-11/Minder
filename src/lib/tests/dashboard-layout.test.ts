// The saved AG Studio report must only point at tables, fields and widget types that exist, or a widget
// silently shows "no data" on the live site. This checks the layout against the data model in code.
import { describe, expect, it } from "vitest";
import { buildStudioData } from "../../components/studio/data";
import { buildDashboardRows } from "../dashboard-data";
import layout from "../dashboard-layout.json";
import { story, storyDb } from "./fixtures";

type Ref = { id: string; aggregation?: string };
type Widget = { type: string; dataMapping?: Record<string, Ref[]>; sort?: { field: Ref }[] };
type Page = { id: string; widgets: Record<string, Widget>; widgetLayout: Record<string, { xTrack: number; yTrack: number; xSpan: number; ySpan: number }> };

const db = storyDb();
// A plain view of the model: the parts this test reads.
type Model = {
  sources: { id: string; fields: { id: string }[]; data: Record<string, unknown>[] }[];
  relationships?: { source: { tableId: string; fieldId: string }; target: { tableId: string; fieldId: string } }[];
  expressions?: { id: string }[];
};
const model = buildStudioData(buildDashboardRows(story(), { policy: db.policy, now: new Date("2026-11-05T12:00:00Z"), cases: db.cases })) as unknown as Model;
const known = new Set<string>([
  ...model.sources.flatMap((s) => s.fields.map((f) => `${s.id}.${f.id}`)),
  ...(model.expressions ?? []).map((e) => e.id),
]);
const pages = (layout as unknown as { pages: Page[] }).pages;
const OURS = ["minder-money-flow", "minder-store-tricks", "minder-cheques"];
const BUILT_IN = ["value", "linear-gauge", "donut-chart", "bar-chart-grouped", "grid", "button-filter"];

describe("the dashboard's saved layout", () => {
  it("has the three pages the tabs name", () => {
    expect(pages.map((p) => p.id)).toEqual(["page-1", "tricks", "recovery"]);
  });
  it("only maps fields that exist in the data model", () => {
    for (const page of pages)
      for (const [id, w] of Object.entries(page.widgets)) {
        const refs = [...Object.values(w.dataMapping ?? {}).flat(), ...(w.sort ?? []).map((s) => s.field)];
        for (const r of refs) expect(known, `${page.id}/${id} maps ${r.id}`).toContain(r.id);
      }
  });
  it("only uses Studio's widget types and Minder's own", () => {
    for (const page of pages) for (const w of Object.values(page.widgets)) expect([...OURS, ...BUILT_IN]).toContain(w.type);
  });
  it("places every widget on the 24-column grid, without overlaps", () => {
    for (const page of pages) {
      const cells = new Set<string>();
      expect(Object.keys(page.widgetLayout).sort()).toEqual(Object.keys(page.widgets).sort());
      for (const [id, l] of Object.entries(page.widgetLayout)) {
        expect(l.xTrack + l.xSpan, `${page.id}/${id}`).toBeLessThanOrEqual(24);
        for (let x = l.xTrack; x < l.xTrack + l.xSpan; x++)
          for (let y = l.yTrack; y < l.yTrack + l.ySpan; y++) {
            expect(cells.has(`${x},${y}`), `${page.id}/${id} overlaps at ${x},${y}`).toBe(false);
            cells.add(`${x},${y}`);
          }
      }
    }
  });
  it("puts the filters and the cheques on the Overview, where the owner looks first", () => {
    const types = Object.values(pages[0].widgets).map((w) => w.type);
    expect(types.filter((t) => t === "button-filter")).toHaveLength(2);
    expect(types).toContain("minder-cheques");
  });
});

describe("the data model", () => {
  it("ties every detail table back to its purchase, so one click filters every widget", () => {
    const rel = (model.relationships ?? []).map((r) => `${r.source.tableId}.${r.source.fieldId}->${r.target.tableId}.${r.target.fieldId}`);
    expect(rel).toEqual(
      expect.arrayContaining([
        "items.purchaseId->purchases.purchaseId",
        "flows.purchaseId->purchases.purchaseId",
        "tricks.purchaseId->purchases.purchaseId",
        "cases.purchaseId->purchases.purchaseId",
        "caseSteps.caseId->cases.caseId",
      ]),
    );
  });
  it("has a row in purchases for every flow, trick and case it links to", () => {
    const ids = new Set(model.sources.find((s) => s.id === "purchases")!.data.map((r) => (r as { purchaseId: string }).purchaseId));
    for (const t of ["flows", "tricks", "cases"])
      for (const r of model.sources.find((s) => s.id === t)!.data) expect(ids, t).toContain((r as { purchaseId: string }).purchaseId);
  });
});
