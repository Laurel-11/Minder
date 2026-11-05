// Exam endpoint.
import { adminAllowed, adminDenied } from "@/lib/admin";
import { DEMO_POLICY, DEMO_RULES_TEXT } from "@/lib/demo-seed";
import { assessPurchase } from "@/lib/purchases";
import { parsePurchaseRequest } from "@/lib/validate";

export const dynamic = "force-dynamic";

/**
 * The exam: run one purchase through the real rules + AI review, against the demo rules and an empty history.
 * Nothing is paid and nothing is saved. Recorded AI answers are never used: the exam grades the live AI.
 */
export async function POST(request: Request) {
  if (!adminAllowed(request)) return adminDenied();
  const parsed = parsePurchaseRequest(await request.json().catch(() => null));
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const started = Date.now();
  const r = await assessPurchase({ policy: DEMO_POLICY, rulesText: DEMO_RULES_TEXT, request: parsed.value, history: [], liveOnly: true });
  return Response.json({
    decision: r.decision,
    ruleOutcome: r.rules.outcome,
    ruleStops: r.rules.checks.filter((c) => c.outcome !== "approve").map((c) => c.message),
    ai: r.ai && { verdict: r.ai.verdict, manipulationSuspected: r.ai.manipulationSuspected, summary: r.ai.summaryForOwner, flags: r.ai.riskFlags, model: r.ai.model },
    aiError: r.aiError,
    reasons: r.reasons,
    ms: Date.now() - started,
  });
}
