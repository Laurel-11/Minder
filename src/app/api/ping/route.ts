// Cheap liveness check for the host (no PayPal or AI calls).
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ ok: true });
}
