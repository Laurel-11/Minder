// The trick-it game: ShopBot shops with a visitor's own note on a product page.
import { readDb } from "@/lib/db";
import { clientIp, overLimit } from "@/lib/rate-limit";
import { runTrick, TRICK_TARGETS } from "@/lib/trick";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  const db = await readDb();
  return Response.json({ board: db.trickBoard ?? { attempts: 0, fooled: 0, caught: 0, slipped: 0, paidOnSlips: 0 } });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { productId?: string; note?: string };
  const note = (body.note ?? "").trim().slice(0, 400);
  if (!TRICK_TARGETS.some((t) => t.productId === body.productId)) return Response.json({ error: "Pick one of the three products." }, { status: 400 });
  if (note.length < 10) return Response.json({ error: "Write a note of at least a few words." }, { status: 400 });
  const mine = overLimit(`try:${clientIp(request)}`, 5, 60_000);
  if (mine.limited) return Response.json({ error: `Five tries a minute. Try again in ${mine.retryInSeconds} seconds.` }, { status: 429 });
  const all = overLimit("try:all", 30, 10 * 60_000);
  if (all.limited) return Response.json({ error: `Lots of people are trying right now. Try again in ${all.retryInSeconds} seconds.` }, { status: 429 });
  try {
    return Response.json(await runTrick(body.productId!, note));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
