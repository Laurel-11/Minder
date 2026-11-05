import { generateJson, readReplay } from "@/lib/ai";
import { readDb } from "@/lib/db";
import { missingEnv } from "@/lib/env";
import { getAccessToken } from "@/lib/paypal";

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
  return Response.json({
    env: { ok: missing.length === 0, detail: missing.length ? `Missing in .env.local: ${missing.join(", ")}` : "All keys present" },
    paypal,
    ai,
    vault: db.vault
      ? { ok: true, detail: `Maya's PayPal is connected (saved ${new Date(db.vault.savedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" })})` }
      : { ok: false, detail: "Maya has not connected PayPal yet" },
  });
}
