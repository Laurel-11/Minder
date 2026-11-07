"use client";

// The public exam: every case with its answer written in advance, the published runs, and a button to run it live.
import { useState } from "react";
import type { ExamCase } from "@/lib/exam-cases";
import { examSummary, expected, grade, GROUP, runExam, secs, WORD, type ExamResult, type ExamRow, type PublishedRun } from "@/lib/exam-run";
import type { Outcome } from "@/lib/types";

const TONE: Record<Outcome | "error", string> = { approve: "text-approve", hold: "text-hold", block: "text-block", error: "text-muted" };

async function ask(c: ExamCase): Promise<ExamResult> {
  const res = await fetch("/api/review/dry-run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ caseId: c.id }) });
  const json = (await res.json().catch(() => ({}))) as ExamResult & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `The exam answered ${res.status}.`);
  return json;
}

export function ExamLab({ cases, runs }: { cases: ExamCase[]; runs: PublishedRun[] }) {
  // Live results by case id: from "Run all", or from one case's own button.
  const [live, setLive] = useState<Record<string, ExamRow>>({});
  const [allRows, setAllRows] = useState<ExamRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [took, setTook] = useState<number | null>(null);

  async function runAll() {
    setBusy(true);
    setTook(null);
    const started = Date.now();
    const rows = await runExam(cases, ask, (r) => {
      setAllRows(r);
      setLive(Object.fromEntries(r.map((x) => [x.c.id, x])));
    });
    setAllRows(rows);
    setTook(Date.now() - started);
    setBusy(false);
  }

  async function runOne(c: ExamCase) {
    const set = (row: ExamRow) => setLive((prev) => ({ ...prev, [c.id]: row }));
    set({ c, state: "running" });
    try {
      const result = await ask(c);
      set({ c, result, state: grade(c, result) });
    } catch (e) {
      set({ c, state: "fail", error: (e as Error).message });
    }
  }

  const done = allRows?.filter((r) => r.result || r.error) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3 rounded-xl border border-line bg-paper p-5">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Run it yourself</h2>
          <p className="mt-1 max-w-prose text-sm text-muted">
            Every case goes through the live rules and the live AI review, exactly as a real purchase would. Nothing is paid or saved, and no recorded answer is
            used. All {cases.length} take about two minutes.
          </p>
        </div>
        <div>
          <button type="button" onClick={runAll} disabled={busy} className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-paper hover:opacity-90 disabled:opacity-50">
            {busy ? `Running (${done.length} of ${cases.length})…` : allRows ? "Run all again" : `Run all ${cases.length}`}
          </button>
        </div>
        {allRows && !busy && (
          <div aria-live="polite" className="flex flex-col gap-1 rounded-lg bg-canvas px-4 py-3 text-sm">
            {examSummary(allRows).map((l) => (
              <p key={l}>{l}</p>
            ))}
            {took !== null && <p className="text-muted">Took {secs(took)}.</p>}
          </div>
        )}
      </section>

      <section aria-labelledby="cases" className="flex flex-col gap-3">
        <h2 id="cases" className="text-xl font-semibold tracking-tight">
          Every case
        </h2>
        <ol className="flex flex-col divide-y divide-line rounded-xl border border-line bg-paper">
          {cases.map((c) => {
            const r = live[c.id];
            return (
              <li key={c.id} className="flex flex-col gap-1.5 px-4 py-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="min-w-0">
                    <span className="mr-2 font-mono text-[12px] text-muted">{c.id}</span>
                    <span className="font-medium">{c.title}</span>
                    {c.fromInterviews && <span className="ml-2 rounded bg-hold-soft px-1.5 py-0.5 text-[11.5px] text-hold">from the interviews</span>}
                  </p>
                  <span className="text-muted">
                    {GROUP[c.group]}. Should {expected(c)}.
                  </span>
                </div>
                {runs.length > 0 && (
                  <p className="text-muted">
                    Published runs:{" "}
                    {runs.map((run, n) => {
                      const got = run.results[c.id];
                      return (
                        <span key={n} className={`mr-2 ${got?.pass ? "text-approve" : "font-semibold text-block"}`}>
                          {got ? `${got.pass ? "✓" : "✗"} ${got.got === "error" ? "error" : WORD[got.got]}` : "not run"}
                        </span>
                      );
                    })}
                  </p>
                )}
                {r && (
                  <p aria-live="polite">
                    {r.state === "running" || r.state === "waiting" ? (
                      <span className="text-muted">{r.state === "running" ? "Running…" : "Waiting…"}</span>
                    ) : r.result ? (
                      <>
                        <span className={`font-semibold ${r.state === "pass" ? "text-approve" : "text-block"}`}>{r.state === "pass" ? "✓ Pass" : "✗ Fail"}</span>{" "}
                        <span className={TONE[r.result.decision]}>Minder would {WORD[r.result.decision]}</span>
                        <span className="text-muted"> in {secs(r.result.ms)}. </span>
                        {r.result.aiError ? (
                          <span className="text-block">AI unavailable: {r.result.aiError}</span>
                        ) : r.result.ai ? (
                          <span className="text-muted">Reviewer: {r.result.ai.summary}</span>
                        ) : (
                          <span className="text-muted">Stopped by code: {r.result.ruleStops.join(" ")}</span>
                        )}
                      </>
                    ) : (
                      <span className="text-block">{r.error}</span>
                    )}
                  </p>
                )}
                <details className="text-muted">
                  <summary className="cursor-pointer">The purchase</summary>
                  <dl className="mt-2 grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3 gap-y-1">
                    <dt>Owner asked</dt>
                    <dd className="text-ink">&ldquo;{c.request.ownerInstruction}&rdquo;</dd>
                    <dt>Store</dt>
                    <dd className="break-words text-ink">
                      {c.request.merchant.name}
                      {c.request.merchant.url?.startsWith("http") ? ` (${c.request.merchant.url})` : ""}
                    </dd>
                    <dt>Order</dt>
                    <dd className="text-ink">
                      {c.request.items.map((i) => `${i.quantity} x ${i.name}, $${i.unitPrice}`).join("; ")}
                    </dd>
                    <dt>Agent said</dt>
                    <dd className="text-ink">{c.request.justification}</dd>
                    <dt>Store page</dt>
                    <dd className="break-words font-mono text-[12px] text-ink">{c.request.pageExcerpt}</dd>
                    {c.recent && (
                      <>
                        <dt>Earlier</dt>
                        <dd className="text-ink">
                          {c.recent
                            .map((x) => `${x.request.items.map((i) => `${i.quantity} x ${i.name}`).join(", ")}, ${x.minutesAgo < 120 ? `${x.minutesAgo} minutes` : `${Math.round(x.minutesAgo / 1440)} days`} ago`)
                            .join("; ")}
                        </dd>
                      </>
                    )}
                  </dl>
                  <button
                    type="button"
                    onClick={() => runOne(c)}
                    disabled={busy || r?.state === "running"}
                    className="mt-2 rounded-md border border-ink bg-white px-3 py-1 text-[13px] font-semibold text-ink hover:bg-[#f4f6f8] disabled:opacity-50"
                  >
                    Run this case
                  </button>
                </details>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
