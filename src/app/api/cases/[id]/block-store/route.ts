import { PurchaseError } from "@/lib/purchases";
import { blockStoreFromCase } from "@/lib/recovery";

export const dynamic = "force-dynamic";

/** Put the store behind a bad order on the owner's blocked list. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return Response.json(await blockStoreFromCase(id));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: e instanceof PurchaseError ? e.status : 500 });
  }
}
