"use client";

import { useState } from "react";
import { EXAM, type ExamCase, type ExamGroup } from "@/lib/exam-cases";
import { DEMO_STEPS, makeApi } from "@/lib/selftest-demo";
import type { Outcome } from "@/lib/types";

type State = "waiting" | "running" | "pass" | "fail" | "skipped";
type DemoRow = { id: string; title: string; state: State; lines: string[]; error?: string; ms?: number };
type ExamResult = {
  decision: Outcome;
  ruleOutcome: Outcome;
  ruleStops: string[];
  ai: { verdict: Outcome; manipulationSuspected: boolean; summary: string; flags: string[]; model: string } | null;
  aiError?: string;
  ms: number;
};
type ExamRow = { c: ExamCase; state: State; result?: ExamResult; error?: string };

const LABEL: Record<State, string> = { waiting: "Waiting", running: "Running", pass: "Pass", fail: "Fail", skipped: "Skipped" };
const TONE: Record<State, string> = { waiting: "text-muted", running: "text-hold", pass: "text-approve", fail: "text-block", skipped: "text-muted" };
const GROUP: Record<ExamGroup, string> = { normal: "Normal", shady: "Shady store", trick: "Trick", rule: "Rule" };
const WORD: Record<Outcome, string> = { approve: "pay", hold: "ask Maya", block: "block" };

const secs = (ms: number) => (ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`);
const expected = (c: ExamCase) => c.expect.map((o) => WORD[o]).join(" or ");

function examSummary(rows: ExamRow[]) {
  const done = rows.filter((r) => r.result);
  const of = (g: ExamGroup) => done.filter((r) => r.c.group === g);
  const count = (list: ExamRow[], d: Outcome) => list.filter((r) => r.result!.decision === d).length;
  const normal = of("normal");
  const tricks = of("trick");
  const rules = of("rule");
  const shady = of("shady");
  const aiDown = done.filter((r) => r.result!.aiError).length;
  const lines = [
    `Tricks caught: ${tricks.length - count(tricks, "approve")} of ${tricks.length} (${count(tricks, "block")} blocked, ${count(tricks, "hold")} held for Maya).`,
    `Normal purchases paid: ${count(normal, "approve")} of ${normal.length} (${count(normal, "hold")} needlessly asked Maya, ${count(normal, "block")} wrongly blocked).`,
    `Fine orders from a store that tries to steer AI agents, held for Maya: ${count(shady, "hold")} of ${shady.length} (${count(shady, "block")} wrongly blocked, ${count(shady, "approve")} paid without a warning).`,
    `Hard rules as expected: ${rules.filter((r) => r.c.expect.includes(r.result!.decision)).length} of ${rules.length} (${rules.filter((r) => !r.result!.ai && !r.result!.aiError).length} decided by code without asking the AI).`,
  ];
  // What an agent with no checks would have done: pay every tricked order exactly as sent.
  const orderTotal = (r: ExamRow) => r.c.request.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
  const trickTotal = tricks.reduce((s, r) => s + orderTotal(r), 0);
  const trickLetThrough = tricks.filter((r) => r.result!.decision === "approve").reduce((s, r) => s + orderTotal(r), 0);
  if (tricks.length) lines.push(`Without any checks, the ${tricks.length} tricked orders would have charged $${trickTotal.toFixed(2)}. Minder let $${trickLetThrough.toFixed(2)} of them through.`);
  const broken = rows.filter((r) => r.error).length;
  if (broken) lines.push(`${broken} case(s) could not run at all; see the red lines below.`);
  if (aiDown) lines.push(`The AI could not be reached on ${aiDown} case(s), so Minder safely asked Maya. Run the exam again for a fair score.`);
  return lines;
}

export function SelfTest({ needsToken }: { needsToken: boolean }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<"demo" | "exam" | "start" | "story" | null>(null);
  const [demo, setDemo] = useState<DemoRow[]>(DEMO_STEPS.map((s) => ({ id: s.id, title: s.title, state: "waiting", lines: [] })));
  const [demoNote, setDemoNote] = useState<string | null>(null);
  const [exam, setExam] = useState<ExamRow[]>(EXAM.map((c) => ({ c, state: "waiting" })));
  const [examNote, setExamNote] = useState<string[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const api = () => makeApi(token.trim() || undefined);

  async function save(kind: "demo" | "exam", markdown: string) {
    try {
      const r = await api()<{ saved: string }>("/api/selftest/report", { kind, markdown });
      return ` Report saved to ${r.saved}.`;
    } catch {
      return " The report could not be saved.";
    }
  }

  async function runDemo() {
    setBusy("demo");
    setDemoNote(null);
    setMessage(null);
    const rows: DemoRow[] = DEMO_STEPS.map((s) => ({ id: s.id, title: s.title, state: "waiting", lines: [] }));
    setDemo([...rows]);
    const call = api();
    const ctx: Record<string, string> = {};
    const started = Date.now();
    let stopped = false;
    for (const [i, step] of DEMO_STEPS.entries()) {
      if (stopped || step.needs?.some((k) => !ctx[k])) {
        rows[i] = { ...rows[i], state: "skipped", lines: [stopped ? "Not run: an earlier step failed." : "Not run: it depends on an earlier step that failed."] };
        setDemo([...rows]);
        continue;
      }
      rows[i] = { ...rows[i], state: "running" };
      setDemo([...rows]);
      const t0 = Date.now();
      try {
        rows[i] = { ...rows[i], state: "pass", lines: await step.run(call, ctx), ms: Date.now() - t0 };
      } catch (e) {
        rows[i] = { ...rows[i], state: "fail", error: (e as Error).message, ms: Date.now() - t0 };
        if (step.stopOnFail) stopped = true;
      }
      setDemo([...rows]);
    }
    const passed = rows.filter((r) => r.state === "pass").length;
    const summary = `${passed} of ${rows.length} steps passed in ${secs(Date.now() - started)}.`;
    const md = [
      "# Minder demo check",
      "",
      `Run ${new Date().toLocaleString("en-US")} against ${location.origin}. Every PayPal line was read back from the PayPal sandbox API.`,
      "",
      `**${summary}**`,
      "",
      ...rows.flatMap((r, n) => [
        `${n + 1}. **${LABEL[r.state].toUpperCase()}** ${r.title}${r.ms ? ` (${secs(r.ms)})` : ""}`,
        ...r.lines.map((l) => `   - ${l}`),
        ...(r.error ? [`   - Problem: ${r.error}`] : []),
      ]),
    ].join("\n");
    setDemoNote(summary + (await save("demo", md)) + " The site now shows the test's purchases. Before recording, choose Reset to the start.");
    setBusy(null);
  }

  async function runExam() {
    setBusy("exam");
    setExamNote(null);
    setMessage(null);
    const rows: ExamRow[] = EXAM.map((c) => ({ c, state: "waiting" }));
    setExam([...rows]);
    const call = api();
    const started = Date.now();
    for (const [i, row] of rows.entries()) {
      rows[i] = { ...row, state: "running" };
      setExam([...rows]);
      try {
        const result = await call<ExamResult>("/api/review/dry-run", row.c.request);
        rows[i] = { ...row, result, state: result.aiError ? "fail" : row.c.expect.includes(result.decision) ? "pass" : "fail" };
      } catch (e) {
        rows[i] = { ...row, state: "fail", error: (e as Error).message };
      }
      setExam([...rows]);
    }
    const summary = examSummary(rows);
    const md = [
      "# Minder exam",
      "",
      `Run ${new Date().toLocaleString("en-US")} against ${location.origin} in ${secs(Date.now() - started)}. ${rows.length} purchases with answers written in advance, run through the same rules and AI review as real purchases (demo rules, empty history). Nothing was paid or saved. Graded by code, not by the AI.`,
      "",
      ...summary.map((l) => `- ${l}`),
      "",
      "| # | Group | Case | Expected | Got | Pass | What the reviewer said |",
      "|---|---|---|---|---|---|---|",
      ...rows.map((r) => {
        const res = r.result;
        const said = r.error ?? res?.aiError ?? (res?.ai ? res.ai.summary : res?.ruleStops.join(" ") || "");
        return `| ${r.c.id} | ${GROUP[r.c.group]} | ${r.c.title} | ${expected(r.c)} | ${res ? WORD[res.decision] : "error"} | ${r.state === "pass" ? "yes" : "no"} | ${said.replace(/\|/g, "/").replace(/\n/g, " ")} |`;
      }),
    ].join("\n");
    setExamNote([...summary, (await save("exam", md)).trim()]);
    setBusy(null);
  }

  async function reset(to: "start" | "story") {
    setBusy(to);
    setMessage(null);
    try {
      const r = await api()<{ backup: string }>("/api/demo/reset", { to });
      setMessage(
        `${to === "start" ? "The demo is back at the start: Maya's rules, nothing bought yet." : "The sample story is loaded."} The old data was backed up as data/backups/${r.backup}.`,
      );
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const primary = "rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-50";
  const secondary = "rounded-lg border-2 border-ink px-4 py-2 text-sm font-medium disabled:opacity-50";

  return (
    <div className="flex flex-col gap-8">
      {needsToken && (
        <label className="flex max-w-sm flex-col gap-2 text-sm">
          <span className="font-medium">Admin token</span>
          <input type="password" value={token} onChange={(e) => setToken(e.target.value)} className="rounded-lg border border-line bg-paper p-2 outline-none focus:border-ink" />
        </label>
      )}

      <section className="flex flex-col gap-4 rounded-lg border border-line bg-paper p-5">
        <div>
          <h2 className="text-xl font-semibold">Demo check</h2>
          <p className="mt-1 max-w-prose text-sm text-muted">
            Plays the whole demo story with real sandbox payments, then looks each result up in PayPal&apos;s own records. It starts by resetting the demo; the
            current data is backed up first. About 3 minutes.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={runDemo} disabled={busy !== null} className={primary}>
            {busy === "demo" ? "Running the demo check…" : "Run the demo check"}
          </button>
          <button onClick={() => reset("start")} disabled={busy !== null} className={secondary}>
            {busy === "start" ? "Resetting…" : "Reset to the start"}
          </button>
          <button onClick={() => reset("story")} disabled={busy !== null} className={secondary}>
            {busy === "story" ? "Loading…" : "Load the sample story"}
          </button>
        </div>
        {message && <p className="text-sm">{message}</p>}
        {demoNote && <p className="text-sm font-medium">{demoNote}</p>}
        <ol className="flex flex-col divide-y divide-line border-t border-line">
          {demo.map((r) => (
            <li key={r.id} className="grid grid-cols-[4.5rem_1fr] gap-x-3 py-3 text-sm">
              <span className={`font-medium ${TONE[r.state]}`}>{LABEL[r.state]}</span>
              <div className="min-w-0">
                <p className="font-medium">
                  {r.title}
                  {r.ms !== undefined && <span className="font-normal text-muted"> {secs(r.ms)}</span>}
                </p>
                {r.lines.map((l, n) => (
                  <p key={n} className="break-words text-muted">
                    {l}
                  </p>
                ))}
                {r.error && <p className="break-words text-block">{r.error}</p>}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col gap-4 rounded-lg border border-line bg-paper p-5">
        <div>
          <h2 className="text-xl font-semibold">Exam</h2>
          <p className="mt-1 max-w-prose text-sm text-muted">
            {EXAM.length} purchases with the right answer written in advance: normal shopping, tricks hidden in store pages, and Maya&apos;s hard rules. Each goes
            through the same rules and AI review as a real purchase. Nothing is paid or saved. About 5 minutes.
          </p>
        </div>
        <div>
          <button onClick={runExam} disabled={busy !== null} className={primary}>
            {busy === "exam" ? `Running the exam (${exam.filter((r) => r.state !== "waiting" && r.state !== "running").length} of ${exam.length})…` : "Run the exam"}
          </button>
        </div>
        {examNote && (
          <div className="flex flex-col gap-1 text-sm font-medium">
            {examNote.map((l, n) => (
              <p key={n}>{l}</p>
            ))}
          </div>
        )}
        <ol className="flex flex-col divide-y divide-line border-t border-line">
          {exam.map((r) => (
            <li key={r.c.id} className="grid grid-cols-[4.5rem_1fr] gap-x-3 py-3 text-sm">
              <span className={`font-medium ${TONE[r.state]}`}>{LABEL[r.state]}</span>
              <div className="min-w-0">
                <p className="font-medium">
                  <span className="font-normal text-muted">{GROUP[r.c.group]}</span> {r.c.title}
                </p>
                <p className="text-muted">
                  Should {expected(r.c)}
                  {r.result && `; Minder would ${WORD[r.result.decision]}`}
                  {r.result && <span> in {secs(r.result.ms)}</span>}
                </p>
                {r.result?.ai && <p className="break-words text-muted">Reviewer: {r.result.ai.summary}</p>}
                {r.result && !r.result.ai && !r.result.aiError && <p className="break-words text-muted">Stopped by code: {r.result.ruleStops.join(" ")}</p>}
                {(r.error || r.result?.aiError) && <p className="break-words text-block">{r.error ?? `AI unavailable: ${r.result?.aiError}`}</p>}
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
