import { runShopBot } from "@/lib/shopbot";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { request?: string };
  const text = (body.request ?? "").trim().slice(0, 500);
  if (text.length < 3) return Response.json({ error: "Tell ShopBot what to buy." }, { status: 400 });
  try {
    return Response.json(await runShopBot(text));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
