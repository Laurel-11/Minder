import { PurchaseError } from "@/lib/purchases";
import { demoStoreAcceptsClaim } from "@/lib/recovery";

export const dynamic = "force-dynamic";

/** Demo control: play the store and accept the claim in PayPal. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const c = await demoStoreAcceptsClaim(id);
    return Response.json({ caseId: c.id, dispute: c.dispute });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: e instanceof PurchaseError ? e.status : 502 });
  }
}
