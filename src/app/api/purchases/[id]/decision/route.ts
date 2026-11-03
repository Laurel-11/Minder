import { decideHeldPurchase, PurchaseError } from "@/lib/purchases";

export const dynamic = "force-dynamic";

/** The owner's one-tap answer to a held purchase. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { decision?: string };
  if (body.decision !== "approve" && body.decision !== "decline") {
    return Response.json({ error: 'decision must be "approve" or "decline"' }, { status: 400 });
  }
  try {
    const p = await decideHeldPurchase(id, body.decision);
    return Response.json({ purchaseId: p.id, status: p.status });
  } catch (e) {
    const status = e instanceof PurchaseError ? e.status : 502;
    return Response.json({ error: (e as Error).message }, { status });
  }
}
