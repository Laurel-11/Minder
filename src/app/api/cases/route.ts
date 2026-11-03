// Recovery cases: list them, or report a problem with a paid purchase.
import { readDb } from "@/lib/db";
import { PurchaseError } from "@/lib/purchases";
import { openCase } from "@/lib/recovery";

export const dynamic = "force-dynamic";

/** Cases, newest first (optionally for one purchase). The same facts the purchase pages show. */
export async function GET(request: Request) {
  const purchaseId = new URL(request.url).searchParams.get("purchaseId");
  const db = await readDb();
  const cases = db.cases.filter((c) => !purchaseId || c.purchaseId === purchaseId);
  return Response.json({
    cases: cases.map((c) => ({
      id: c.id,
      purchaseId: c.purchaseId,
      status: c.status,
      problem: c.problem,
      openedBy: c.openedBy,
      lastOffer: c.messages.filter((m) => m.from === "merchant").at(-1)?.offer,
      recommendation: c.recommendation?.action,
      refund: c.refund,
      dispute: c.dispute,
    })),
  });
}

/** The owner reports a problem with a paid purchase. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { purchaseId?: string; problem?: string; note?: string };
  if (!body.purchaseId || (body.problem !== "not_delivered" && body.problem !== "damaged")) {
    return Response.json({ error: 'purchaseId and problem ("not_delivered" or "damaged") are required.' }, { status: 400 });
  }
  try {
    const c = await openCase(body.purchaseId, body.problem, "owner", body.note?.trim().slice(0, 500) || undefined);
    return Response.json({ caseId: c.id, status: c.status });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: e instanceof PurchaseError ? e.status : 502 });
  }
}
