import { updateDb } from "@/lib/db";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { createVaultSetupToken } from "@/lib/paypal";

export const dynamic = "force-dynamic";

/** Step 1 of "connect PayPal once": ask PayPal for an approval link. */
export async function POST() {
  try {
    const { setupTokenId, approveUrl } = await createVaultSetupToken(
      `${env.appUrl}/api/paypal/return`,
      `${env.appUrl}/?connect=cancelled`,
    );
    await updateDb((db) => {
      db.pendingSetupTokens = [{ id: setupTokenId, createdAt: new Date().toISOString() }, ...db.pendingSetupTokens].slice(0, 5);
    });
    log("vault.setup_token.created");
    return Response.json({ approveUrl });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
