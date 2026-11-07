// Downloads: the whole receipt book, or the evidence pack for one purchase. Both carry Minder's public key and can be
// checked offline with scripts/verify-receipts.mjs.
import { readDb } from "@/lib/db";
import { env } from "@/lib/env";
import { checkBook, publicKey } from "@/lib/receipts";

export const dynamic = "force-dynamic";

const HOW = "Check it yourself: node scripts/verify-receipts.mjs <this file>  (https://github.com/Laurel-11/Minder). Compare the key id with the one shown on the site's Receipts page.";

const download = (name: string, body: unknown) =>
  new Response(JSON.stringify(body, null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${name}"` } });

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("purchase");
  const db = await readDb();
  const book = db.receipts ?? [];
  const keys = [publicKey()];
  const site = env.appUrl;
  if (!id) {
    return download("minder-receipt-book.json", { format: "minder-receipt-book-v1", site, downloadedAt: new Date().toISOString(), keys, check: checkBook(book), receipts: book, howToCheck: HOW });
  }
  const p = db.purchases.find((x) => x.id === id && x.source !== "trick");
  if (!p) return Response.json({ error: "No such purchase." }, { status: 404 });
  const c = db.cases.find((x) => x.purchaseId === p.id);
  return download(`minder-evidence-${p.id}.json`, {
    format: "minder-evidence-v1",
    site,
    downloadedAt: new Date().toISOString(),
    keys,
    about: "Minder's signed receipts for one purchase, with the evidence they fingerprint: what the owner asked for, what the store's page said, what the agent and the AI review said.",
    purchase: {
      id: p.id,
      createdAt: p.createdAt,
      request: p.request,
      total: p.total,
      decision: p.decision,
      status: p.status,
      reasons: p.reasons,
      ai: p.ai,
      paypal: p.paypal,
    },
    case: c ?? null,
    receipts: book.filter((r) => r.purchaseId === p.id),
    book: { count: book.length, lastHash: book.at(-1)?.hash ?? null },
    howToCheck: HOW,
  });
}
