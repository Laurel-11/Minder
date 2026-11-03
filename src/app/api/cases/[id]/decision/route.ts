import { PurchaseError } from "@/lib/purchases";
import { resolveCase } from "@/lib/recovery";

export const dynamic = "force-dynamic";

/** The owner accepts the store's offer, or escalates to PayPal. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { action?: string };
  if (body.action !== "accept" && body.action !== "escalate") return Response.json({ error: 'action must be "accept" or "escalate"' }, { status: 400 });
  try {
    const c = await resolveCase(id, body.action);
    return Response.json({ caseId: c.id, status: c.status });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: e instanceof PurchaseError ? e.status : 502 });
  }
}
