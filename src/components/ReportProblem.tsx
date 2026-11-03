"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ReportProblem({ purchaseId, delivered }: { purchaseId: string; delivered: boolean }) {
  const router = useRouter();
  const [problem, setProblem] = useState<"damaged" | "not_delivered">(delivered ? "damaged" : "not_delivered");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purchaseId, problem, note }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Could not open a case.");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-paper p-4">
      <p className="font-semibold">Something wrong with this order?</p>
      <div className="flex flex-wrap gap-2 text-sm">
        {(
          [
            ["damaged", "It arrived damaged"],
            ["not_delivered", "It never arrived"],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className={`cursor-pointer rounded-full border px-3 py-1.5 ${problem === value ? "border-ink bg-ink text-paper" : "border-line"}`}>
            <input type="radio" name="problem" value={value} checked={problem === value} onChange={() => setProblem(value)} className="sr-only" />
            {label}
          </label>
        ))}
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder="What happened? For example: the shade is cracked, but the lamp still works."
        className="rounded-lg border border-line p-2 text-sm outline-none focus:border-ink"
      />
      <button onClick={submit} disabled={busy} className="w-fit rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper disabled:opacity-50">
        {busy ? "Chaperone is writing to the store…" : "Get my money back"}
      </button>
      {error && <p className="text-sm text-block">{error}</p>}
    </div>
  );
}
