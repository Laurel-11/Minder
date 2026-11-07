"use client";

// "Change one and see": the visitor edits a copy of a receipt and the server checks the copy, exactly as it checks
// the book. Nothing in the book changes.
import { useState } from "react";
import type { Receipt } from "@/lib/types";

type Result = { check: { contents: boolean; signature: boolean; knownSigner: boolean; chain: boolean }; changed: string[] | null; inBook: boolean };

const pretty = (r: Receipt) => JSON.stringify(r, null, 2);

function hint(r: Receipt): string {
  const f = r.facts as { decision?: string; total?: number; amount?: number };
  if (f.decision === "block") return 'change "decision": "block" to "approve", or the total by one cent.';
  if (typeof f.total === "number") return "change the total by one cent.";
  if (typeof f.amount === "number") return "change the amount by one cent.";
  return "change one word of what it says.";
}

export function ReceiptTamper({ receipts }: { receipts: Receipt[] }) {
  const [n, setN] = useState(receipts[0]?.n ?? 0);
  const original = receipts.find((r) => r.n === n) ?? receipts[0];
  const [text, setText] = useState(original ? pretty(original) : "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!original) return null;

  function pick(next: number) {
    const r = receipts.find((x) => x.n === next);
    if (!r) return;
    setN(next);
    setText(pretty(r));
    setResult(null);
    setError(null);
  }

  async function check() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      let receipt: unknown;
      try {
        receipt = JSON.parse(text);
      } catch {
        throw new Error("That is no longer valid JSON. Undo your last change, or start again from the original.");
      }
      const res = await fetch("/api/receipts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ receipt }) });
      const json = (await res.json()) as Result & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "The check did not run.");
      setResult(json);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const lines = result && [
    { ok: result.check.contents, yes: "Its contents match its fingerprint.", no: "Its contents no longer match its fingerprint." },
    {
      ok: result.check.knownSigner && result.check.signature,
      yes: "Minder's signature fits.",
      no: result.check.knownSigner ? "Minder's signature does not fit this fingerprint." : "It claims a signer this site does not use.",
    },
    { ok: result.check.chain, yes: "It points at the receipt before it.", no: "It no longer points at the receipt before it." },
  ];
  const allOk = lines?.every((l) => l.ok);

  return (
    <section id="change-one" className="flex scroll-mt-6 flex-col gap-4 rounded-xl border border-line bg-paper p-5">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Change one and see</h2>
        <p className="mt-1 max-w-prose text-sm text-muted">
          This is a copy of a real receipt from the book. Change anything, a cent of the total or one word, and check it. The server checks your copy the same
          way it checks the book. The book itself does not change.
        </p>
      </div>
      <label className="flex flex-wrap items-center gap-2 text-sm">
        <span>Receipt</span>
        <select value={n} onChange={(e) => pick(Number(e.target.value))} className="max-w-full rounded-md border border-line bg-white px-2 py-1.5">
          {receipts.map((r) => (
            <option key={r.n} value={r.n}>
              #{r.n}: {r.says.length > 70 ? `${r.says.slice(0, 68)}…` : r.says}
            </option>
          ))}
        </select>
      </label>
      <p className="text-sm">Try it: {hint(original)}</p>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setResult(null);
        }}
        spellCheck={false}
        aria-label={`A copy of receipt #${n}, as JSON`}
        className="h-72 w-full resize-y rounded-md border border-line bg-[#fbfcf8] p-3 font-mono text-[12px] leading-relaxed"
      />
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={check} disabled={busy} className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-paper hover:opacity-90 disabled:opacity-50">
          {busy ? "Checking…" : "Check this copy"}
        </button>
        <button type="button" onClick={() => pick(n)} className="rounded-md border border-ink bg-white px-4 py-2 text-sm font-semibold hover:bg-[#f4f6f8]">
          Start again from the original
        </button>
      </div>
      {error && <p className="text-sm text-block">{error}</p>}
      {result && lines && (
        <div aria-live="polite" className={`rounded-lg px-4 py-3 text-sm ${allOk ? "bg-approve-soft" : "bg-block-soft"}`}>
          <p className={`font-semibold ${allOk ? "text-approve" : "text-block"}`}>
            {allOk ? "This copy is exactly what Minder wrote." : "This copy is not what Minder wrote, and the check shows it."}
          </p>
          <ul className="mt-2 space-y-1">
            {lines.map((l) => (
              <li key={l.yes} className={l.ok ? "text-approve" : "text-block"}>
                {l.ok ? "✓" : "✗"} {l.ok ? l.yes : l.no}
              </li>
            ))}
          </ul>
          {result.changed && result.changed.length > 0 && <p className="mt-2 text-muted">You changed: {result.changed.join(", ")}.</p>}
          {!allOk && result.check.contents === false && (
            <p className="mt-2 text-muted">
              To hide a change you would have to write a new fingerprint, and then Minder&apos;s signature no longer fits. Making a new signature takes Minder&apos;s
              private key, which never leaves the server.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
