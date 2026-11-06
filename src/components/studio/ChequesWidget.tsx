"use client";

// A custom AG Studio widget: every purchase that is waiting for the owner, drawn as a cheque with the
// owner's two buttons. PayPal is already holding the money; only the owner's click sends or releases it.
// The widget reads which purchases are waiting from Studio's data (so page filters apply), then fetches
// each one's full record, the same one the auditor agent shows in the chat.
import type { AgWidgetField, AgWidgetParams } from "ag-studio";
import { useEffect, useMemo, useState } from "react";
import type { PurchaseRecord } from "@/lib/studio-tools";
import { Cheque } from "./ToolCards";

type ChequesState = { dataMapping: { purchase?: AgWidgetField[]; status?: AgWidgetField[] } };

/** How the purchases table words a purchase that is waiting for the owner. */
export const WAITING = /^waiting for you$/i;

async function record(id: string, signal: AbortSignal): Promise<PurchaseRecord | undefined> {
  const r = await fetch(`/api/studio/purchases?q=${encodeURIComponent(id)}`, { signal });
  const j = (await r.json().catch(() => ({}))) as { matches?: PurchaseRecord[] };
  return j.matches?.find((m) => m.purchaseId === id);
}

export default function ChequesWidget(props: AgWidgetParams<ChequesState>) {
  const { widgetApi, dataMapping } = props;
  const purchase = (dataMapping.purchase ?? [])[0] as AgWidgetField | undefined;
  const status = (dataMapping.status ?? [])[0] as AgWidgetField | undefined;
  const fields = useMemo(() => [purchase, status].filter((f): f is AgWidgetField => !!f), [purchase, status]);
  const [waiting, setWaiting] = useState<PurchaseRecord[] | null>(null);
  // Cheques the owner just signed or declined stay on screen with their result until the page reloads.
  const [decided, setDecided] = useState<PurchaseRecord[]>([]);

  useEffect(() => {
    const abort = new AbortController();
    if (!purchase || !status) {
      widgetApi.setDisplayState("incompleteDataMapping");
      return;
    }
    widgetApi.setDisplayState("loading");
    widgetApi
      .getData({ fields })
      .then(async (res) => {
        const ids = [
          ...new Set(res.results.rows.filter((r) => WAITING.test(widgetApi.formatFieldValue(status, r[status.key]))).map((r) => String(r[purchase.key]))),
        ].slice(0, 6);
        const found = (await Promise.all(ids.map((id) => record(id, abort.signal).catch(() => undefined)))).filter((m): m is PurchaseRecord => !!m);
        if (abort.signal.aborted) return;
        setWaiting(found);
        widgetApi.setDisplayState("displayed");
      })
      .catch(() => {
        if (!abort.signal.aborted) widgetApi.setDisplayState("noData");
      });
    return () => abort.abort();
    // `props` is a new object exactly when Studio refreshes this widget.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props]);

  if (!purchase || !status || waiting === null) return null;
  const shown = [...decided, ...waiting.filter((w) => !decided.some((d) => d.purchaseId === w.purchaseId))];
  if (!shown.length) {
    return (
      <div className="absolute inset-0 flex flex-col justify-center gap-2 px-1 text-[14px] text-muted">
        <p className="font-medium text-ink">Nothing is waiting for you.</p>
        <p>When ShopBot asks to spend more than your limit, PayPal holds the money and the cheque appears here for you to sign or decline.</p>
      </div>
    );
  }
  return (
    <ul aria-label="Purchases waiting for your signature" className="absolute inset-0 flex flex-col gap-3 overflow-y-auto pr-1">
      {shown.map((m) => (
        <li key={m.purchaseId}>
          <Cheque purchase={m} compact onDecided={() => setDecided((d) => (d.some((x) => x.purchaseId === m.purchaseId) ? d : [...d, m]))} />
        </li>
      ))}
    </ul>
  );
}
