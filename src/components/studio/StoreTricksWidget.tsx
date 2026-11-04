"use client";

// A custom AG Studio widget: the words store pages hid for AI shopping agents, as the AI review
// caught them, each stamped with what Chaperone did about it. Click one to filter the dashboard to
// that store.
import type { AgWidgetField, AgWidgetParams } from "ag-studio";
import { useEffect, useMemo, useState } from "react";

type TricksState = { dataMapping: { quote?: AgWidgetField[]; store?: AgWidgetField[]; outcome?: AgWidgetField[]; amount?: AgWidgetField[] }; format?: { style?: { showAmounts?: boolean } } };
type Trick = { quote: string; store: string; storeRaw: unknown; outcome: string; amount: number | null };

const tone = (outcome: string) =>
  /block|fail/i.test(outcome) ? "text-block" : /wait|asked|hold/i.test(outcome) ? "text-hold" : /declin/i.test(outcome) ? "text-muted" : "text-approve";
const unquote = (s: string) => s.trim().replace(/^["“”']+|["“”']+$/g, "").trim();

export default function StoreTricksWidget(props: AgWidgetParams<TricksState>) {
  const { widgetApi, dataMapping, format } = props;
  const field = (k: keyof TricksState["dataMapping"]) => (dataMapping[k] ?? [])[0] as AgWidgetField | undefined;
  const quote = field("quote");
  const store = field("store");
  const outcome = field("outcome");
  const amount = field("amount");
  const fields = useMemo(() => [quote, store, outcome, amount].filter((f): f is AgWidgetField => !!f), [quote, store, outcome, amount]);
  const showAmounts = format?.style?.showAmounts ?? true;
  const [tricks, setTricks] = useState<Trick[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    if (!quote) {
      widgetApi.setDisplayState("incompleteDataMapping");
      return;
    }
    widgetApi.setDisplayState("loading");
    widgetApi
      .getData({ fields })
      .then((res) => {
        if (cancelled) return;
        const list: Trick[] = res.results.rows
          .filter((r) => typeof r[quote.key] === "string" && unquote(r[quote.key]))
          .map((r) => ({
            quote: unquote(r[quote.key]),
            store: store ? widgetApi.formatFieldValue(store, r[store.key]) : "",
            storeRaw: store ? r[store.key] : undefined,
            outcome: outcome ? widgetApi.formatFieldValue(outcome, r[outcome.key]) : "",
            amount: amount ? Number(r[amount.key]) || 0 : null,
          }));
        const sel = new Set<string>();
        for (const s of widgetApi.getCrossFilterSelections() ?? []) {
          if (s.type === "value" && store && s.field.fieldId === store.fieldId) for (const v of s.values) sel.add(widgetApi.formatFieldValue(store, v));
        }
        setPicked(sel);
        setTricks(list);
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

  if (!quote || !tricks?.length) return null;
  const filterBy = (t: Trick) => {
    if (store) widgetApi.toggleCrossFilter({ type: "value", field: store, value: t.storeRaw, group: 0 });
  };

  return (
    <ul className="absolute inset-0 flex flex-col divide-y divide-[#e6eaef] overflow-y-auto px-2 text-ink">
      {tricks.map((t, i) => {
        const dim = picked.size > 0 && !picked.has(t.store);
        return (
          <li key={i} className={dim ? "opacity-40" : ""}>
            <button
              type="button"
              onClick={() => filterBy(t)}
              disabled={!store}
              aria-pressed={picked.has(t.store)}
              className="grid w-full grid-cols-[1fr_auto] items-start gap-x-4 gap-y-1.5 rounded px-1 py-3 text-left hover:bg-[#f7f9fa] disabled:cursor-default"
            >
              <blockquote className="relative pl-4 text-[14px] leading-[1.5]">
                <span aria-hidden="true" className="absolute -top-1 left-0 text-[22px] leading-none text-[#8a94a6]">
                  &ldquo;
                </span>
                {t.quote}
                {"\u201d"}
              </blockquote>
              {t.outcome ? <span className={`stamp mt-0.5 text-[12px] ${tone(t.outcome)}`}>{t.outcome}</span> : <span />}
              <span className="col-span-2 pl-4 text-[12.5px] text-muted">
                {t.store && <span className="font-semibold text-ink">{t.store}</span>}
                {showAmounts && t.amount !== null && amount && <span>{`${t.store ? ", " : ""}${widgetApi.formatFieldValue(amount, t.amount)} order`}</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
