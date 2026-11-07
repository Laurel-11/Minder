// Exam endpoint: anyone can run the exam's cases against the live rules and AI review. Nothing is paid or saved.
import { adminAllowed } from "@/lib/admin";
import { DEMO_POLICY, DEMO_RULES_TEXT } from "@/lib/demo-seed";
import { EXAM, examHistory, type ExamCase } from "@/lib/exam-cases";
import { assessPurchase } from "@/lib/purchases";
import { clientIp, overLimit } from "@/lib/rate-limit";
import type { PurchaseRequest } from "@/lib/types";
import { parsePurchaseRequest } from "@/lib/validate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Run one purchase through the real rules + AI review, against the demo rules. Send { caseId } to run one of the
 * exam's own cases (with its earlier purchases), or a purchase request to try your own. Recorded AI answers are never
 * used: the exam grades the live AI.
 */
export async function POST(request: Request) {
  if (!adminAllowed(request)) {
    const mine = overLimit(`exam:${clientIp(request)}`, 80, 10 * 60_000);
    if (mine.limited) return Response.json({ error: `That is a lot of exam runs. Try again in ${mine.retryInSeconds} seconds.` }, { status: 429 });
    const all = overLimit("exam:all", 600, 60 * 60_000);
    if (all.limited) return Response.json({ error: `Many people are running the exam. Try again in ${all.retryInSeconds} seconds.` }, { status: 429 });
  }
  const body = (await request.json().catch(() => null)) as { caseId?: string } | null;
  let req: PurchaseRequest;
  let examCase: ExamCase | undefined;
  if (body?.caseId) {
    examCase = EXAM.find((x) => x.id === body.caseId);
    if (!examCase) return Response.json({ error: `No exam case ${body.caseId}.` }, { status: 404 });
    req = examCase.request;
  } else {
    const parsed = parsePurchaseRequest(body);
    if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
    req = parsed.value;
  }
  const now = new Date();
  const started = Date.now();
  const r = await assessPurchase({ policy: DEMO_POLICY, rulesText: DEMO_RULES_TEXT, request: req, history: examCase ? examHistory(examCase, now) : [], now, liveOnly: true });
  return Response.json({
    decision: r.decision,
    ruleOutcome: r.rules.outcome,
    ruleStops: r.rules.checks.filter((c) => c.outcome !== "approve").map((c) => c.message),
    ai: r.ai && { verdict: r.ai.verdict, manipulationSuspected: r.ai.manipulationSuspected, summary: r.ai.summaryForOwner, flags: r.ai.riskFlags, model: r.ai.model },
    aiError: r.aiError,
    reasons: r.reasons,
    market: r.market && r.market.items.map((i) => ({ item: i.item, typical: i.typical, stores: i.stores })),
    ms: Date.now() - started,
  });
}
