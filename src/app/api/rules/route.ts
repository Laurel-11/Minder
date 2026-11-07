import { updateDb } from "@/lib/db";
import { log } from "@/lib/log";
import { demoNow } from "@/lib/clock";
import { parseRules } from "@/lib/policy-ai";
import { addReceipt, rulesReceipt } from "@/lib/receipts";

export const dynamic = "force-dynamic";

/** Translate the owner's plain-language rules into a policy and save both. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { text?: string };
  const text = (body.text ?? "").trim().slice(0, 2000);
  if (text.length < 5) return Response.json({ error: "Write at least one rule." }, { status: 400 });
  try {
    const { policy, model } = await parseRules(text);
    await updateDb((db) => {
      db.rulesText = text;
      db.policy = policy;
      addReceipt(db, rulesReceipt(text, policy, demoNow(db).toISOString()));
    });
    log("rules.saved", { model, budgets: policy.budgets.length, threshold: policy.approvalThreshold });
    return Response.json({ policy, model });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
