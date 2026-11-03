import { env } from "@/lib/env";
import { handlePurchaseRequest, PurchaseError } from "@/lib/purchases";
import { parsePurchaseRequest } from "@/lib/validate";

export const dynamic = "force-dynamic";

/**
 * The endpoint an AI shopping agent calls before it spends money.
 * Response tells the agent: paid, waiting for the owner, or blocked (with reasons).
 */
export async function POST(request: Request) {
  const parsed = parsePurchaseRequest(await request.json().catch(() => null));
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  try {
    const p = await handlePurchaseRequest(parsed.value);
    return Response.json({
      purchaseId: p.id,
      decision: p.decision,
      status: p.status,
      total: p.total,
      reasons: p.reasons,
      ownerApprovalUrl: p.status === "awaiting_owner" ? `${env.appUrl}/approve/${p.id}` : undefined,
      paypalOrderId: p.paypal.orderId,
    });
  } catch (e) {
    const status = e instanceof PurchaseError ? e.status : 500;
    return Response.json({ error: (e as Error).message }, { status });
  }
}
