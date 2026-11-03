"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usd } from "@/lib/money";
import type { ShopBotRun } from "@/lib/shopbot";
import { VerdictStamp } from "./VerdictStamp";

const SUGGESTIONS = [
  "Buy me a bag of medium roast coffee beans",
  "Order a USB-C charging cable for my phone",
  "Find a birthday gift for my mom. She loves music. Around $100 to $150.",
];

const PROGRESS = ["Reading the demo stores", "Choosing products", "Asking Chaperone for permission to pay", "Waiting for Chaperone's decision"];

type Turn = { request: string; run?: ShopBotRun; error?: string };

export function ShopBotChat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setProgress((p) => Math.min(p + 1, PROGRESS.length - 1)), 3500);
    return () => clearInterval(t);
  }, [busy]);

  useEffect(() => {
    // Block body on purpose: newer browsers return a Promise from scrollIntoView, which React would treat as a cleanup function.
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, busy]);

  async function send(text: string) {
    const request = text.trim();
    if (!request || busy) return;
    setInput("");
    setBusy(true);
    setProgress(0);
    setTurns((t) => [...t, { request }]);
    let result: Turn = { request };
    try {
      const res = await fetch("/api/shopbot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request }) });
      const json = (await res.json()) as ShopBotRun & { error?: string };
      result = res.ok ? { request, run: json } : { request, error: json.error ?? "ShopBot failed." };
    } catch (e) {
      result = { request, error: (e as Error).message };
    }
    setTurns((t) => [...t.slice(0, -1), result]);
    setBusy(false);
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-line bg-paper">
      <div className="flex items-center gap-3 border-b border-line bg-[#f4f2fb] px-4 py-3">
        <span aria-hidden className="grid h-9 w-9 place-items-center rounded-full bg-[#5b4bc4] text-sm font-semibold text-paper">SB</span>
        <div>
          <p className="font-semibold leading-tight">ShopBot</p>
          <p className="text-xs text-muted">Demo shopping agent. It pays through Chaperone.</p>
        </div>
      </div>

      <div className="flex min-h-[320px] flex-col gap-4 p-4">
        {turns.length === 0 && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">Tell ShopBot what to buy, or try one of these:</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)} className="rounded-full border border-line px-3 py-1.5 text-left text-sm hover:border-ink">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((turn, n) => (
          <div key={n} className="flex flex-col gap-3">
            <p className="self-end rounded-2xl rounded-br-sm bg-ink px-4 py-2 text-sm text-paper">{turn.request}</p>
            {!turn.run && !turn.error && (
              <p className="self-start text-sm text-muted" aria-live="polite">
                {PROGRESS[progress]}…
              </p>
            )}
            {turn.error && <p className="self-start text-sm text-block">{turn.error}</p>}
            {turn.run && <AgentReply run={turn.run} />}
          </div>
        ))}
        <div ref={bottom} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex gap-2 border-t border-line p-3"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask ShopBot to buy something"
          disabled={busy}
          className="flex-1 rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-ink"
        />
        <button type="submit" disabled={busy || input.trim().length < 3} className="rounded-lg bg-[#5b4bc4] px-4 py-2 text-sm font-medium text-paper disabled:opacity-50">
          Send
        </button>
      </form>
    </div>
  );
}

function AgentReply({ run }: { run: ShopBotRun }) {
  const c = run.chaperone;
  return (
    <div className="flex flex-col gap-3 self-start sm:max-w-[85%]">
      <div className="rounded-2xl rounded-bl-sm bg-[#f4f2fb] px-4 py-3 text-sm">
        <p>{run.agentMessage}</p>
        {run.order && (
          <ul className="mt-2 space-y-0.5 text-muted">
            {run.order.items.map((i, n) => (
              <li key={n} className="flex justify-between gap-6">
                <span>
                  {i.quantity > 1 ? `${i.quantity} × ` : ""}
                  {i.name}
                </span>
                <span className="tabular-nums">{usd(i.price * i.quantity)}</span>
              </li>
            ))}
            <li className="flex justify-between gap-6 font-medium text-ink">
              <span>{run.order.storeName}</span>
              <span className="tabular-nums">{usd(run.order.total)}</span>
            </li>
          </ul>
        )}
      </div>

      {c && (
        <div className="rounded-lg border border-line px-4 py-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <p className="font-semibold">Chaperone</p>
            {c.status && <VerdictStamp status={c.status} animate />}
          </div>
          {c.error && <p className="mt-2 text-block">{c.error}</p>}
          {c.reasons && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
              {c.reasons.map((r, n) => (
                <li key={n}>{r}</li>
              ))}
            </ul>
          )}
          {c.status === "awaiting_owner" && c.purchaseId && (
            <Link href={`/purchases/${c.purchaseId}`} className="mt-3 inline-flex rounded-lg bg-ink px-3 py-1.5 text-paper">
              Review and decide
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
