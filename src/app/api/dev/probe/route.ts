// Development-only probe for trying PayPal endpoints from the running app. Disabled in production.
import { getAccessToken } from "@/lib/paypal";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") return new Response("Not found", { status: 404 });
  const { method = "GET", path, body } = (await request.json()) as { method?: string; path: string; body?: unknown };
  if (!path?.startsWith("/v")) return Response.json({ error: "path must start with /v" }, { status: 400 });
  const token = await getAccessToken();
  const res = await fetch(`https://api-m.sandbox.paypal.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "PayPal-Request-Id": crypto.randomUUID() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = text;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  return Response.json({ status: res.status, debugId: res.headers.get("paypal-debug-id"), body: json });
}
