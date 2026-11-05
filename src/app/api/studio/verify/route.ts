import { readSharedDb } from "@/lib/db";
import { log } from "@/lib/log";
import { verifyWithPayPal } from "@/lib/studio-tools";

export const dynamic = "force-dynamic";

/** For the dashboard's auditor agent: compare one purchase with PayPal's own records. Read-only. */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("purchaseId") ?? "";
  if (!/^pur_[A-Za-z0-9-]{4,40}$/.test(id)) return Response.json({ error: "A purchase id like pur_1234abcd is required." }, { status: 400 });
  try {
    const result = await verifyWithPayPal(await readSharedDb(), id);
    log("studio.verify", { id, allMatch: result.allMatch, checks: result.checks.length });
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
