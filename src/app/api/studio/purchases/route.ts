import { readSharedDb } from "@/lib/db";
import { findPurchases } from "@/lib/studio-tools";

export const dynamic = "force-dynamic";

/** For the dashboard's auditor agent: find purchases by id, store, item or the owner's words. Read-only. */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.slice(0, 200) ?? "";
  if (!q.trim()) return Response.json({ error: "Say which purchase: an id, a store or an item." }, { status: 400 });
  const db = await readSharedDb();
  return Response.json({ matches: findPurchases(db, q) });
}
