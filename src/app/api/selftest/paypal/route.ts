import { adminAllowed, adminDenied } from "@/lib/admin";
import { getDispute, getOrder, getRefund } from "@/lib/paypal";

export const dynamic = "force-dynamic";

type J = Record<string, unknown>;
const amountOf = (a: unknown) => (a as { value?: string } | undefined)?.value;

/** Look a record up in PayPal itself, so the self-test checks PayPal's books rather than Chaperone's own. */
export async function POST(request: Request) {
  if (!adminAllowed(request)) return adminDenied();
  const { kind, id } = (await request.json().catch(() => ({}))) as { kind?: string; id?: string };
  if (!id || !/^[A-Za-z0-9-]{6,40}$/.test(id)) return Response.json({ error: "A PayPal id is required." }, { status: 400 });
  try {
    if (kind === "order") {
      const o = await getOrder(id);
      const unit = ((o.purchase_units as J[]) ?? [])[0] ?? {};
      const payments = (unit.payments ?? {}) as { captures?: J[]; authorizations?: J[] };
      const trackers = ((unit.shipping as J | undefined)?.trackers as J[] | undefined) ?? [];
      return Response.json({
        status: o.status,
        amount: amountOf(unit.amount),
        captures: (payments.captures ?? []).map((c) => ({ id: c.id, status: c.status, amount: amountOf(c.amount) })),
        authorizations: (payments.authorizations ?? []).map((a) => ({ id: a.id, status: a.status, amount: amountOf(a.amount) })),
        trackers: trackers.length,
      });
    }
    if (kind === "refund") {
      const r = await getRefund(id);
      return Response.json({ status: r.status, amount: amountOf(r.amount) });
    }
    if (kind === "dispute") {
      const d = await getDispute(id);
      return Response.json({ status: d.status, amount: amountOf(d.dispute_amount), reason: d.reason, stage: d.dispute_life_cycle_stage });
    }
    return Response.json({ error: 'kind must be "order", "refund" or "dispute".' }, { status: 400 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
