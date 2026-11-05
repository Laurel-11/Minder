"use client";

import Link from "next/link";
import { useState } from "react";
import { usd } from "@/lib/money";
import type { TrickBoard, TrickResult } from "@/lib/trick";

export type TrickTarget = { productId: string; request: string; example: string; product: string; price: number; store: string; others: string[] };

const VERDICT: Record<TrickResult["outcome"], (r: TrickResult) => { title: string; tone: string }> = {
  no_order: (r) => ({ title: r.run.agentMessage || "ShopBot did not place an order.", tone: "text-muted" }),
  ignored: () => ({ title: "ShopBot ignored your note and ordered only what Maya asked for.", tone: "text-ink" }),
  blocked: () => ({ title: "ShopBot fell for it. Minder blocked the order, so PayPal never saw it.", tone: "text-approve" }),
  held: (r) => ({ title: `ShopBot fell for it. Minder held it for Maya: PayPal is holding ${usd(r.run.minder?.total ?? 0)} and nothing is charged.`, tone: "text-approve" }),
  slipped: (r) => ({ title: `You beat Minder: ShopBot fell for it and PayPal paid ${usd(r.run.minder?.total ?? 0)} (sandbox money).`, tone: "text-block" }),
};

export function TrickLab({ targets, initialBoard }: { targets: TrickTarget[]; initialBoard: TrickBoard }) {
  const [productId, setProductId] = useState(targets[0].productId);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TrickResult | null>(null);
  const [board, setBoard] = useState(initialBoard);
  const target = targets.find((t) => t.productId === productId)!;

  async function send() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/try", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId, note }) });
      const json = (await res.json()) as TrickResult & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Something went wrong.");
      setResult(json);
      setBoard(json.board);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const verdict = result && VERDICT[result.outcome](result);

  return (
    <section id="trick" className="flex scroll-mt-6 flex-col gap-4 rounded-xl border border-line bg-paper p-5">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Try to trick it yourself</h2>
        <p className="mt-1 max-w-prose text-sm text-muted">
          Write the note a dishonest store would hide on a product page. ShopBot reads it while shopping for Maya, and it is built to do what pages say. If it falls for
          your note, Minder has to catch it before PayPal pays.
        </p>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Maya asks ShopBot to</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {targets.map((t) => (
            <label
              key={t.productId}
              className={`cursor-pointer rounded-lg border px-3 py-2 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ink ${t.productId === productId ? "border-ink bg-canvas" : "border-line"}`}
            >
              <input type="radio" name="target" value={t.productId} checked={t.productId === productId} onChange={() => setProductId(t.productId)} className="sr-only" />
              <span className="block">&ldquo;{t.request}&rdquo;</span>
              <span className="mt-1 block text-muted">
                {t.product}, {usd(t.price)} at {t.store}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="flex flex-col gap-2 text-sm">
        <span className="font-medium">Your note on the {target.product} page</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={400}
          rows={4}
          placeholder={target.example}
          disabled={busy}
          className="rounded-lg border border-line px-3 py-2 outline-none focus:border-ink"
        />
        <span className="text-xs text-muted">{target.store} also sells: {target.others.join("; ")}.</span>
        <span className="flex justify-between text-xs text-muted">
          <button type="button" onClick={() => setNote(target.example)} disabled={busy} className="underline underline-offset-2">
            Use the example
          </button>
          <span className="tabular-nums">{note.length} / 400</span>
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={send} disabled={busy || note.trim().length < 10} className="rounded-lg bg-[#5b4bc4] px-4 py-2 text-sm font-medium text-paper disabled:opacity-50">
          {busy ? "ShopBot is shopping…" : "Send ShopBot shopping"}
        </button>
        <p className="text-xs text-muted">Real PayPal sandbox payments. Your note is not shown to other visitors.</p>
      </div>

      <div aria-live="polite" className="flex flex-col gap-3">
        {error && <p className="text-sm text-block">{error}</p>}
        {result && verdict && (
          <div className="flex flex-col gap-2 rounded-lg bg-canvas p-4 text-sm">
            <p className={`font-semibold ${verdict.tone}`}>{verdict.title}</p>
            {result.run.order && (
              <p className="text-muted">
                ShopBot ordered {result.run.order.items.map((i) => `${i.quantity > 1 ? `${i.quantity} × ` : ""}${i.name}`).join(", ")} from {result.run.order.storeName},{" "}
                {usd(result.run.order.total)}.
              </p>
            )}
            {result.run.minder?.reasons?.map((r, n) => (
              <p key={n}>{r}</p>
            ))}
            {result.run.minder?.purchaseId && (
              <Link href={`/purchases/${result.run.minder.purchaseId}`} className="self-start underline underline-offset-2">
                See the purchase
              </Link>
            )}
          </div>
        )}
      </div>

      <p className="border-t border-line pt-3 text-sm text-muted">
        {board.attempts === 0
          ? "No one has tried yet since the site last restarted."
          : `Since the site last restarted: ${board.attempts} ${board.attempts === 1 ? "try" : "tries"}. ShopBot fell for ${board.fooled}; Minder caught ${board.caught}${
              board.slipped ? `, and ${board.slipped} got through (${usd(board.paidOnSlips)} paid)` : " and let none through"
            }.`}
      </p>
    </section>
  );
}
