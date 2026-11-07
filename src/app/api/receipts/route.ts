// The receipt book: read it with its check, or check a copy of one receipt (the "change one and see" panel).
import { readDb } from "@/lib/db";
import { clientIp, overLimit } from "@/lib/rate-limit";
import { checkBook, checkReceipt, GENESIS, publicKey } from "@/lib/receipts";
import type { Receipt } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = await readDb();
  const book = db.receipts ?? [];
  const trick = new Set(db.purchases.filter((p) => p.source === "trick").map((p) => p.id));
  return Response.json({
    key: publicKey(),
    check: checkBook(book),
    receipts: [...book].reverse().map((r) => ({ ...r, fromTrickPage: Boolean(r.purchaseId && trick.has(r.purchaseId)) })),
  });
}

/** Paths where two JSON values differ, e.g. "facts.total". */
function differences(a: unknown, b: unknown, path = ""): string[] {
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return JSON.stringify(a) === JSON.stringify(b) ? [] : [path || "(the whole receipt)"];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].flatMap((k) => differences((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], path ? `${path}.${k}` : k));
}

export async function POST(request: Request) {
  const limit = overLimit(`receipt-check:${clientIp(request)}`, 30, 60_000);
  if (limit.limited) return Response.json({ error: `Too many checks. Try again in ${limit.retryInSeconds} seconds.` }, { status: 429 });
  const text = await request.text();
  if (text.length > 20_000) return Response.json({ error: "That is too long to be one receipt." }, { status: 413 });
  let copy: Receipt;
  try {
    copy = (JSON.parse(text) as { receipt?: Receipt }).receipt as Receipt;
    if (!copy || typeof copy !== "object" || typeof copy.n !== "number") throw new Error();
  } catch {
    return Response.json({ error: "Paste one whole receipt, as JSON." }, { status: 400 });
  }
  const book = (await readDb()).receipts ?? [];
  const stored = book.find((r) => r.n === copy.n);
  const prev = copy.n === 1 ? GENESIS : book.find((r) => r.n === copy.n - 1)?.hash;
  const check = checkReceipt(copy, [publicKey()], prev);
  return Response.json({ check, changed: stored ? differences(stored, copy) : null, inBook: Boolean(stored) });
}
