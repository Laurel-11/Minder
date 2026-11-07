// Development-only probe for the market price check: what Channel3 returns for a query, trimmed. Disabled in production.
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

type Raw = { products?: { title?: string; offers?: { domain?: string; price?: unknown; availability?: string }[] }[] };

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") return new Response("Not found", { status: 404 });
  const { query } = (await request.json()) as { query: string };
  const res = await fetch("https://api.trychannel3.com/v1/search", {
    method: "POST",
    headers: { "x-api-key": env.channel3ApiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ query, limit: 8, filters: { conditions: ["new"], availability: ["InStock"] }, config: { country: "US", currency: "USD" } }),
  });
  const json = (await res.json().catch(() => ({}))) as Raw & Record<string, unknown>;
  return Response.json({
    status: res.status,
    keys: Object.keys(json),
    products: (json.products ?? []).map((p) => ({ title: p.title, offers: (p.offers ?? []).slice(0, 3) })),
    error: res.ok ? undefined : json,
  });
}
