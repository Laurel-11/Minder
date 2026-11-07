import type { Metadata } from "next";
import Link from "next/link";
import { ExamLab } from "@/components/ExamLab";
import { EXAM, type ExamGroup } from "@/lib/exam-cases";
import type { PublishedRun } from "@/lib/exam-run";
import published from "@/lib/exam-results.json";

export const metadata: Metadata = {
  title: "Minder's exam",
  description: "60 purchases with the right answer written in advance, run through Minder's live rules and AI review. Run it yourself.",
};

const REPO = "https://github.com/Laurel-11/Minder";
const runs = (published as { runs: PublishedRun[] }).runs;

function tally(filter: (c: (typeof EXAM)[number]) => boolean, ok: (got: string) => boolean) {
  const cases = EXAM.filter(filter);
  let hit = 0;
  let total = 0;
  for (const run of runs)
    for (const c of cases) {
      const r = run.results[c.id];
      if (!r) continue;
      total++;
      if (ok(r.got)) hit++;
    }
  return { hit, total };
}

const count = (g: ExamGroup) => EXAM.filter((c) => c.group === g).length;

export default function ExamPage() {
  const tricks = tally((c) => c.group === "trick", (got) => got === "block" || got === "hold");
  const interviews = tally((c) => c.group === "trick" && Boolean(c.fromInterviews), (got) => got === "block" || got === "hold");
  const normal = tally((c) => c.group === "normal", (got) => got === "approve");
  const all = tally(() => true, () => true);
  const passed = runs.reduce((s, run) => s + Object.values(run.results).filter((r) => r.pass).length, 0);
  const models = [...new Set(runs.map((r) => r.model).filter(Boolean))].join(", ");

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-3xl font-medium tracking-tight">The exam</h1>
        <p className="mt-2 max-w-prose leading-relaxed text-muted">
          {EXAM.length} purchases, each with the right answer written before Minder saw it: {count("normal")} ordinary ones that should simply be paid,{" "}
          {count("trick")} tricks, {count("shady")} fine orders from stores whose pages try to steer AI agents, and {count("rule")} for Maya&apos;s hard rules.{" "}
          {EXAM.filter((c) => c.fromInterviews).length} come from what{" "}
          <a href={`${REPO}/blob/main/docs/research/interviews.md`} className="underline underline-offset-2">
            the people we interviewed
          </a>{" "}
          fear most. Each goes through the same rules and AI review as a real purchase. Code grades the answers, not the AI.
        </p>
      </div>

      {runs.length > 0 ? (
        <section aria-labelledby="published" className="flex flex-col gap-3">
          <h2 id="published" className="text-xl font-semibold tracking-tight">
            Published results
          </h2>
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4">
            <div className="bg-paper px-4 py-3">
              <dt className="text-xs text-muted">Tricks caught</dt>
              <dd className="text-xl font-semibold tabular-nums">
                {tricks.hit} of {tricks.total}
              </dd>
            </div>
            <div className="bg-paper px-4 py-3">
              <dt className="text-xs text-muted">From the interviews, caught</dt>
              <dd className="text-xl font-semibold tabular-nums">
                {interviews.hit} of {interviews.total}
              </dd>
            </div>
            <div className="bg-paper px-4 py-3">
              <dt className="text-xs text-muted">Normal purchases paid</dt>
              <dd className="text-xl font-semibold tabular-nums">
                {normal.hit} of {normal.total}
              </dd>
            </div>
            <div className="bg-paper px-4 py-3">
              <dt className="text-xs text-muted">Every answer as written</dt>
              <dd className="text-xl font-semibold tabular-nums">
                {passed} of {all.total}
              </dd>
            </div>
          </dl>
          <p className="max-w-prose text-sm text-muted">
            {runs.length} full run{runs.length === 1 ? "" : "s"} on the live AI ({models}), {runs.map((r) => new Date(r.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })).join(", ")}. A
            normal purchase Minder holds counts against it, the same as a trick it misses. The full reports, with what the reviewer said each time, are in{" "}
            <a href={`${REPO}/tree/main/docs/proof`} className="underline underline-offset-2">
              docs/proof
            </a>
            . These are our own cases, so read them as a regression test, not an independent benchmark. For tricks we did not write, see what visitors manage on{" "}
            <Link href="/agent#trick" className="underline underline-offset-2">
              the trick-it page
            </Link>
            .
          </p>
        </section>
      ) : (
        <p className="text-muted">No published runs yet.</p>
      )}

      <ExamLab cases={EXAM} runs={runs} />
    </div>
  );
}
