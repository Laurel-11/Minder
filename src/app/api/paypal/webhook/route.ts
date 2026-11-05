// PayPal calls this when money moves or a dispute changes. Every delivery is checked with PayPal before it is used.
import { after } from "next/server";
import { receiveWebhook } from "@/lib/paypal-events";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > 512_000) return Response.json({ error: "Too large." }, { status: 413 });
  const h = (name: string) => request.headers.get(name) ?? "";
  const result = await receiveWebhook(raw, {
    authAlgo: h("paypal-auth-algo"),
    certUrl: h("paypal-cert-url"),
    transmissionId: h("paypal-transmission-id"),
    transmissionSig: h("paypal-transmission-sig"),
    transmissionTime: h("paypal-transmission-time"),
  });
  if (result.followUp) after(result.followUp);
  return Response.json(result.body, { status: result.status });
}
