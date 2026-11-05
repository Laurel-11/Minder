import type { NextRequest } from "next/server";
import { readDb, updateDb } from "@/lib/db";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { createPaymentToken } from "@/lib/paypal";

export const dynamic = "force-dynamic";

/** Step 2: PayPal sends Maya back here after she approves. Turn the approval into a reusable payment token. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const candidates = [params.get("approval_session_id"), params.get("approval_token_id")].filter(Boolean) as string[];
  const db = await readDb();
  const pending = db.pendingSetupTokens.find((t) => candidates.includes(t.id)) ?? db.pendingSetupTokens[0];
  if (!pending) return Response.redirect(`${env.appUrl}/?connect=missing`, 303);
  try {
    const { vaultId, customerId } = await createPaymentToken(pending.id);
    await updateDb((d) => {
      d.vault = { vaultId, customerId, savedAt: new Date().toISOString() };
      delete d.vaultRevokedAt;
      d.pendingSetupTokens = [];
    });
    log("vault.saved");
    return Response.redirect(`${env.appUrl}/?connect=ok`, 303);
  } catch (e) {
    log("vault.save_failed", { error: (e as Error).message });
    return Response.redirect(`${env.appUrl}/?connect=failed`, 303);
  }
}
