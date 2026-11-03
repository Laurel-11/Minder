import { PurchaseError } from "@/lib/purchases";
import { refreshDispute } from "@/lib/recovery";

export const dynamic = "force-dynamic";

/** Ask PayPal for the latest status of the dispute behind a case. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const c = await refreshDispute(id);
    return Response.json({ caseId: c.id, dispute: c.dispute });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: e instanceof PurchaseError ? e.status : 502 });
  }
}
