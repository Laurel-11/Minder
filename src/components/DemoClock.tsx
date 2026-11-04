"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Demo time travel, so a late delivery can be shown without waiting days. */
export function DemoClock({ days }: { days: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function move(body: { addDays?: number; reset?: boolean }) {
    setBusy(true);
    setNote(null);
    const res = await fetch("/api/demo/clock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json()) as { casesOpened?: number };
    if (json.casesOpened) setNote(`Minder noticed ${json.casesOpened === 1 ? "a late order" : `${json.casesOpened} late orders`} and opened a case.`);
    setBusy(false);
    router.refresh();
  }

  return (
    <section className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-line px-4 py-3 text-sm text-muted">
      <span>Demo time: {days === 0 ? "today" : `${days} days from now`}</span>
      <button onClick={() => move({ addDays: 3 })} disabled={busy} className="rounded-lg border border-line bg-paper px-3 py-1.5 text-ink disabled:opacity-50">
        {busy ? "Moving time…" : "Skip 3 days ahead"}
      </button>
      {days > 0 && (
        <button onClick={() => move({ reset: true })} disabled={busy} className="underline underline-offset-2 disabled:opacity-50">
          Back to today
        </button>
      )}
      {note && <span className="text-hold">{note}</span>}
    </section>
  );
}
