import { generateJson, readReplay } from "@/lib/ai";
import { readDb } from "@/lib/db";
import { missingEnv } from "@/lib/env";
import { getAccessToken } from "@/lib/paypal";
import { canReceiveWebhooks, ensureWebhook } from "@/lib/paypal-events";
import { marketEnabled } from "@/lib/market";
import { checkBook, publicKey } from "@/lib/receipts";

export const dynamic = "force-dynamic";

type Check = { ok: boolean; detail: string };

export async function GET() {
  const missing = missingEnv();
  const [paypal, ai, db] = await Promise.all([
    getAccessToken()
      .then((): Check => ({ ok: true, detail: "Connected to the PayPal sandbox" }))
      .catch((e: Error): Check => ({ ok: false, detail: e.message })),
    generateJson<{ ok: boolean }>({
      system: "You are a health check. Answer with the JSON requested.",
      prompt: 'Return {"ok": true}.',
      schema: { type: "OBJECT", properties: { ok: { type: "BOOLEAN" } }, required: ["ok"] },
      timeoutMs: 20_000,
    })
      .then((r): Check => ({ ok: r.data.ok === true, detail: `Model ${r.model} answered` }))
      .catch((e: Error): Check => {
        const recorded = Object.keys(readReplay()).length;
        return { ok: false, detail: `${e.message}${recorded ? `. Until it is back, ${recorded} recorded answers keep the sample requests working.` : ""}` };
      }),
    readDb(),
  ]);
  const last = db.paypalEvents?.[0];
  const webhooks: Check = canReceiveWebhooks()
    ? await ensureWebhook()
        .then((h): Check =>
          h
            ? {
                ok: true,
                detail: `PayPal sends ${h.events.length} kinds of event to ${h.url}, each signature checked with PayPal. ${
                  last ? `Latest: "${last.summary}" (${last.type}, ${new Date(last.receivedAt).toUTCString()}).` : "None received since the site last restarted."
                }`,
              }
            : { ok: false, detail: "No webhook set up." },
        )
        .catch((e: Error): Check => ({ ok: false, detail: e.message }))
    : { ok: true, detail: "PayPal sends its notifications to the public site. This copy runs without a public address, so it checks PayPal directly instead." };
  const book = checkBook(db.receipts ?? []);
  const receipts: Check = book.ok
    ? { ok: true, detail: `${book.count} receipts, every fingerprint, signature and link checks out (key ${publicKey().id}).` }
    : { ok: false, detail: book.problems[0]?.problem ?? "The book does not check out." };
  return Response.json({
    env: { ok: missing.length === 0, detail: missing.length ? `Missing in .env.local: ${missing.join(", ")}` : "All keys present" },
    paypal,
    ai,
    webhooks,
    vault: db.vaultRevokedAt
      ? { ok: false, detail: "Maya removed Minder's permission in her PayPal account, so Minder pays for nothing until she reconnects." }
      : db.vault
      ? { ok: true, detail: `Maya's PayPal is connected (saved ${new Date(db.vault.savedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" })})` }
      : { ok: false, detail: "Maya has not connected PayPal yet" },
    receipts,
    market: marketEnabled()
      ? { ok: true, detail: "On: before paying, Minder looks each item up in Channel3's catalog of real retailers." }
      : { ok: true, detail: "Off: no CHANNEL3_API_KEY, so purchases are checked without market prices." },
  });
}
