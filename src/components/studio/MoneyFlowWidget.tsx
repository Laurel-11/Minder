"use client";

// A custom AG Studio widget: where every dollar ShopBot asked to spend went. Each column is one
// field from the "Stages" mapping (by default: asked, which check settled it, what happened at
// checkout, where the money is now). Ribbons are coloured by where that money ended up, so the
// story reads at a glance: green stayed with the owner, amber is waiting, slate reached a store.
// Click a block to filter the rest of the dashboard to it.
import type { AgWidgetField, AgWidgetParams } from "ag-studio";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";

export type MoneyFlowStyle = { showAmounts?: boolean; showStageNames?: boolean };
type FlowState = { dataMapping: { stages?: AgWidgetField[]; value?: AgWidgetField[] }; format?: { style?: MoneyFlowStyle } };

const INK = "#1b2333";
const SLATE = "#5b6475";
const GREEN = "#1d7a4e";
const AMBER = "#a9620a";
const RED = "#c0352b";
const GREY = "#8a94a6";
const FALLBACK = [INK, SLATE, GREY, AMBER, GREEN, "#3d6a5f", "#7a5c2e"];

// Minder's own stage values, in the order that keeps ribbons from crossing: what stayed with the
// owner on top, what reached a store at the bottom.
const ORDER = [
  "ShopBot asked to pay",
  "Code limits",
  "AI review",
  "Your signature",
  "Passed every check",
  "Blocked",
  "Declined",
  "Waiting for you",
  "Paid",
  "Payment failed",
  "Never left you",
  "Held in PayPal",
  "In a PayPal dispute",
  "Refunded to you",
  "With the store",
];
const NODE_COLOR: Record<string, string> = {
  "ShopBot asked to pay": INK,
  "Code limits": RED,
  "AI review": RED,
  "Your signature": AMBER,
  "Passed every check": SLATE,
  Blocked: RED,
  Declined: RED,
  "Waiting for you": AMBER,
  Paid: INK,
  "Payment failed": GREY,
  "Never left you": GREEN,
  "Held in PayPal": AMBER,
  "In a PayPal dispute": AMBER,
  "Refunded to you": GREEN,
  "With the store": INK,
};
// Ribbons take the colour of where the money ended up.
const OUTCOME_COLOR: Record<string, string> = {
  "Never left you": GREEN,
  "Refunded to you": GREEN,
  "Held in PayPal": AMBER,
  "In a PayPal dispute": AMBER,
  "With the store": SLATE,
};

type Path = { key: string; labels: string[]; raws: unknown[]; amount: number };
type FlowNode = { id: string; col: number; label: string; raw: unknown; amount: number; color: string; rank: number; y: number; h: number };
type Segment = { path: Path; col: number; from: FlowNode; to: FlowNode; y0: number; y1: number; w: number; color: string };
type Hover = { kind: "node"; node: FlowNode } | { kind: "segment"; seg: Segment } | null;

const rankOf = (label: string) => {
  const i = ORDER.indexOf(label);
  return i === -1 ? ORDER.length : i;
};

function buildColumns(paths: Path[], cols: number) {
  const columns: FlowNode[][] = [];
  for (let c = 0; c < cols; c++) {
    const byLabel = new Map<string, FlowNode>();
    for (const p of paths) {
      const label = p.labels[c];
      const node = byLabel.get(label) ?? { id: `${c}:${label}`, col: c, label, raw: p.raws[c], amount: 0, color: "", rank: rankOf(label), y: 0, h: 0 };
      node.amount += p.amount;
      byLabel.set(label, node);
    }
    const nodes = [...byLabel.values()].sort((a, b) => a.rank - b.rank || b.amount - a.amount || a.label.localeCompare(b.label));
    nodes.forEach((n, i) => (n.color = NODE_COLOR[n.label] ?? FALLBACK[(i + c) % FALLBACK.length]));
    columns.push(nodes);
  }
  return columns;
}

const outcomeColor = (p: Path, columns: FlowNode[][]) => {
  const last = p.labels.at(-1)!;
  return OUTCOME_COLOR[last] ?? columns.at(-1)!.find((n) => n.label === last)?.color ?? SLATE;
};

/** Lay the flow out left to right in a w x h box. */
function layoutHorizontal(paths: Path[], cols: number, w: number, h: number, top: number, labelRoom: number) {
  const columns = buildColumns(paths, cols);
  const total = paths.reduce((s, p) => s + p.amount, 0);
  const nodeW = 12;
  const bottom = 6;
  const avail = Math.max(40, h - top - bottom);
  const maxCount = Math.max(...columns.map((c) => c.length));
  const gap = Math.min(12, (avail * 0.35) / Math.max(1, maxCount - 1));
  const k = (avail - gap * (maxCount - 1)) / total;
  const span = Math.max(40, w - labelRoom - nodeW);
  const xOf = (c: number) => (cols === 1 ? 0 : (c * span) / (cols - 1));
  for (const nodes of columns) {
    const colH = total * k + gap * (nodes.length - 1);
    let y = top + (avail - colH) / 2;
    for (const n of nodes) {
      n.y = y;
      n.h = Math.max(1, n.amount * k);
      y += n.h + gap;
    }
  }
  const node = (c: number, label: string) => columns[c].find((n) => n.label === label)!;
  const segments: Segment[] = [];
  for (let c = 0; c < cols - 1; c++) {
    const segs = paths.map((p) => ({ path: p, col: c, from: node(c, p.labels[c]), to: node(c + 1, p.labels[c + 1]), y0: 0, y1: 0, w: p.amount * k, color: outcomeColor(p, columns) }));
    const finalRank = (s: Segment) => rankOf(s.path.labels.at(-1)!);
    // Leave each block in the order of where the money goes next; arrive in the order of where it came from.
    const out = new Map<string, number>();
    for (const s of [...segs].sort((a, b) => a.to.y - b.to.y || finalRank(a) - finalRank(b) || a.path.key.localeCompare(b.path.key))) {
      const off = out.get(s.from.id) ?? 0;
      s.y0 = s.from.y + off;
      out.set(s.from.id, off + s.w);
    }
    const inn = new Map<string, number>();
    for (const s of [...segs].sort((a, b) => a.from.y - b.from.y || finalRank(a) - finalRank(b) || a.path.key.localeCompare(b.path.key))) {
      const off = inn.get(s.to.id) ?? 0;
      s.y1 = s.to.y + off;
      inn.set(s.to.id, off + s.w);
    }
    segments.push(...segs);
  }
  return { columns, segments, total, nodeW, xOf };
}

function ribbonPath(x0: number, x1: number, y0: number, y1: number, w: number) {
  const xm = (x0 + x1) / 2;
  return `M${x0},${y0}C${xm},${y0} ${xm},${y1} ${x1},${y1}L${x1},${y1 + w}C${xm},${y1 + w} ${xm},${y0 + w} ${x0},${y0 + w}Z`;
}

/** Spread labels in a column so none overlap, keeping each as close to its block as possible. */
function spreadLabels(nodes: FlowNode[], minGap: number, top: number, bottom: number) {
  const ys = nodes.map((n) => n.y + n.h / 2);
  for (let i = 1; i < ys.length; i++) ys[i] = Math.max(ys[i], ys[i - 1] + minGap);
  const overflow = ys.length ? ys[ys.length - 1] - bottom : 0;
  if (overflow > 0) {
    ys[ys.length - 1] -= overflow;
    for (let i = ys.length - 2; i >= 0; i--) ys[i] = Math.min(ys[i], ys[i + 1] - minGap);
  }
  return ys.map((y) => Math.max(top + minGap / 2, y));
}

const approxWidth = (s: string, px = 12) => s.length * px * 0.56;

export default function MoneyFlowWidget(props: AgWidgetParams<FlowState>) {
  const { widgetApi, dataMapping, format } = props;
  const stages = useMemo(() => (dataMapping.stages ?? []) as AgWidgetField[], [dataMapping.stages]);
  const value = (dataMapping.value ?? [])[0] as AgWidgetField | undefined;
  const showAmounts = format?.style?.showAmounts ?? true;
  const showStageNames = format?.style?.showStageNames ?? true;

  const [paths, setPaths] = useState<Path[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<Hover>(null);
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.floor(e.contentRect.width), h: Math.floor(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Studio hands us new props whenever the mapping, the filters or the cross-filter change: fetch again then.
  useEffect(() => {
    let cancelled = false;
    if (!stages.length || !value) {
      widgetApi.setDisplayState("incompleteDataMapping");
      return;
    }
    widgetApi.setDisplayState("loading");
    widgetApi
      .getData({ fields: [...stages, value] })
      .then((res) => {
        if (cancelled) return;
        const merged = new Map<string, Path>();
        for (const row of res.results.rows) {
          const amount = Number(row[value.key]) || 0;
          if (amount <= 0) continue;
          const raws = stages.map((f) => row[f.key]);
          const labels = stages.map((f, i) => (raws[i] == null || raws[i] === "" ? "(blank)" : widgetApi.formatFieldValue(f, raws[i])));
          const k = labels.join("\u0001");
          const p = merged.get(k) ?? { key: k, labels, raws, amount: 0 };
          p.amount += amount;
          merged.set(k, p);
        }
        const list = [...merged.values()];
        const picks = new Set<string>();
        for (const sel of widgetApi.getCrossFilterSelections() ?? []) {
          if (sel.type !== "value") continue;
          const c = stages.findIndex((f) => f.fieldId === sel.field.fieldId);
          if (c === -1) continue;
          for (const v of sel.values) picks.add(`${c}:${widgetApi.formatFieldValue(stages[c], v)}`);
        }
        setSelected(picks);
        setPaths(list);
        widgetApi.setDisplayState(list.length ? "displayed" : "noData");
      })
      .catch(() => {
        if (!cancelled) widgetApi.setDisplayState("noData");
      });
    return () => {
      cancelled = true;
    };
    // `props` is a new object exactly when Studio refreshes this widget.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props]);

  const money = (n: number) => (value ? widgetApi.formatFieldValue(value, n) : n.toFixed(2));
  const stageNames = stages.map((f) => widgetApi.getFieldName(f));

  const toggle = (n: FlowNode) => widgetApi.toggleCrossFilter({ type: "value", field: stages[n.col], value: n.raw, group: 0 });
  const onKey = (e: KeyboardEvent, n: FlowNode) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle(n);
    }
  };

  // A horizontal flow needs room for every column's labels; below that, stack the stages instead.
  const narrow = size.w > 0 && size.w < 160 * Math.max(1, stages.length - 1) + 200;
  const ready = stages.length > 0 && !!value && paths && paths.length > 0 && size.w > 0 && size.h > 0;

  let body: ReactNode = null;
  if (ready && !narrow) {
    const top = showStageNames ? 22 : 6;
    const lastLabels = buildColumns(paths, stages.length).at(-1)!;
    const labelRoom = Math.min(190, 18 + Math.max(...lastLabels.map((n) => approxWidth(n.label) + (showAmounts ? approxWidth(` ${money(n.amount)}`) : 0))));
    const { columns, segments, total, nodeW, xOf } = layoutHorizontal(paths, stages.length, size.w, size.h, top, labelRoom);
    const active = (p: Path) => {
      if (hover?.kind === "segment") return hover.seg.path === p;
      if (hover?.kind === "node") return p.labels[hover.node.col] === hover.node.label;
      if (selected.size) return p.labels.some((l, c) => selected.has(`${c}:${l}`));
      return true;
    };
    const anyFocus = hover !== null || selected.size > 0;
    body = (
      <svg width={size.w} height={size.h} role="img" aria-label={`Money flow: ${columns.at(-1)!.map((n) => `${n.label} ${money(n.amount)}`).join(", ")}`}>
        {showStageNames &&
          stageNames.map((name, c) => (
            <text key={c} x={c === stages.length - 1 ? xOf(c) + nodeW : xOf(c)} y={12} fontSize={11.5} fill={SLATE} textAnchor={c === stages.length - 1 ? "end" : "start"}>
              {name}
            </text>
          ))}
        <g>
          {segments.map((s, i) => (
            <path
              key={i}
              d={ribbonPath(xOf(s.col) + nodeW, xOf(s.col + 1), s.y0, s.y1, s.w)}
              fill={s.color}
              fillOpacity={anyFocus ? (active(s.path) ? 0.55 : 0.08) : 0.32}
              onMouseEnter={() => setHover({ kind: "segment", seg: s })}
              onMouseLeave={() => setHover(null)}
              style={{ transition: "fill-opacity 120ms" }}
            />
          ))}
        </g>
        {columns.map((nodes, c) => {
          const ys = spreadLabels(nodes, 16, top, size.h - 4);
          return (
            <g key={c}>
              {nodes.map((n, i) => {
                const isSel = selected.has(n.id);
                const dim = selected.size > 0 && !isSel && !(hover?.kind === "node" && hover.node.id === n.id);
                return (
                  <g
                    key={n.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSel}
                    aria-label={`${stageNames[c]}: ${n.label}, ${money(n.amount)}. Filter the dashboard to this.`}
                    onClick={() => toggle(n)}
                    onKeyDown={(e) => onKey(e, n)}
                    onMouseEnter={() => setHover({ kind: "node", node: n })}
                    onMouseLeave={() => setHover(null)}
                    onFocus={() => setHover({ kind: "node", node: n })}
                    onBlur={() => setHover(null)}
                    style={{ cursor: "pointer", outline: "none" }}
                    opacity={dim ? 0.35 : 1}
                  >
                    <rect x={xOf(c)} y={n.y} width={nodeW} height={n.h} rx={2} fill={n.color} />
                    {isSel && <rect x={xOf(c) - 3} y={n.y - 3} width={nodeW + 6} height={n.h + 6} rx={4} fill="none" stroke={INK} strokeWidth={1.5} />}
                    <rect x={xOf(c) - 4} y={Math.min(n.y, ys[i] - 9)} width={nodeW + 8} height={Math.max(n.h, 18)} fill="transparent" />
                    <text
                      x={c === stages.length - 1 ? xOf(c) + nodeW + 8 : xOf(c) + nodeW + 6}
                      y={ys[i]}
                      dy="0.35em"
                      fontSize={12}
                      fill={INK}
                      stroke="#ffffff"
                      strokeWidth={3}
                      strokeLinejoin="round"
                      paintOrder="stroke"
                    >
                      <tspan fontWeight={600}>{n.label}</tspan>
                      {showAmounts && <tspan fill={SLATE}>{` ${money(n.amount)}`}</tspan>}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}
        <desc>{`Total ${money(total)}`}</desc>
      </svg>
    );
  } else if (ready && narrow) {
    // On a narrow widget the flow becomes a stack of breakdowns, one per stage, read top to bottom.
    const columns = buildColumns(paths, stages.length);
    const total = paths.reduce((s, p) => s + p.amount, 0);
    body = (
      <div className="flex h-full flex-col gap-3 overflow-y-auto pr-1 text-[13px]">
        {columns.map((nodes, c) =>
          nodes.length === 1 && c === 0 ? (
            <div key={c} className="flex items-baseline justify-between gap-3 border-b border-[#e6eaef] pb-2">
              <span className="font-semibold">{nodes[0].label}</span>
              <span className="tabular-nums text-[#5b6475]">{money(nodes[0].amount)}</span>
            </div>
          ) : (
            <section key={c} className="flex flex-col gap-1.5">
              {showStageNames && <div className="text-[12px] text-[#5b6475]">{stageNames[c]}</div>}
              <div className="flex h-2.5 overflow-hidden rounded-sm bg-[#eceff3]" aria-hidden="true">
                {nodes.map((n) => (
                  <span key={n.id} style={{ width: `${(n.amount / total) * 100}%`, background: n.color, opacity: selected.size && !selected.has(n.id) ? 0.35 : 1 }} />
                ))}
              </div>
              <ul className="flex flex-col">
                {nodes.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => toggle(n)}
                      aria-pressed={selected.has(n.id)}
                      className={`flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-[#f4f6f8] ${selected.has(n.id) ? "bg-[#eef1f5] font-semibold" : ""}`}
                    >
                      <span className="size-2.5 shrink-0 rounded-[2px]" style={{ background: n.color }} aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate">{n.label}</span>
                      {showAmounts && <span className="tabular-nums text-[#5b6475]">{money(n.amount)}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ),
        )}
      </div>
    );
  }

  let tip: string | null = null;
  if (hover && paths && !narrow) {
    const total = paths.reduce((s, p) => s + p.amount, 0);
    if (hover.kind === "segment") tip = `${hover.seg.path.labels.join(" → ")}: ${money(hover.seg.path.amount)}`;
    else tip = `${hover.node.label}: ${money(hover.node.amount)}, ${Math.round((hover.node.amount / total) * 100)}% of the total. Click to filter.`;
  }

  return (
    <div
      ref={box}
      className="absolute inset-0 select-none px-2 pb-1"
      style={{ color: INK }}
      onMouseMove={(e: MouseEvent<HTMLDivElement>) => {
        const r = e.currentTarget.getBoundingClientRect();
        setMouse({ x: e.clientX - r.left, y: e.clientY - r.top });
      }}
      onMouseLeave={() => setMouse(null)}
    >
      {body}
      {tip && mouse && (
        <div
          className="pointer-events-none absolute z-10 max-w-[280px] rounded-md border border-[#d3d9e0] bg-white px-2.5 py-1.5 text-[12px] leading-snug shadow-sm"
          style={{ left: Math.min(mouse.x + 12, Math.max(0, size.w - 290)), top: mouse.y + 14 }}
        >
          {tip}
        </div>
      )}
    </div>
  );
}
