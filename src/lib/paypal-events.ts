// PayPal webhooks: PayPal tells Minder the moment money moves, a hold is released, a dispute changes,
// or the owner removes Minder's permission in their PayPal account. Each delivery is checked with PayPal's
// own signature API before Minder believes it, and each event is applied once, even when PayPal resends it.
import { demoNow } from "./clock";
import { updateDb } from "./db";
import { env } from "./env";
import { log } from "./log";
import { usd } from "./money";
import { createWebhook, listWebhookEventTypes, listWebhooks, setWebhookEvents, verifyWebhookSignature, type WebhookHeaders } from "./paypal";
import { disputeInWords, outcomeInWords } from "./case-money";
import { storeAnswersCase } from "./recovery";
import type { Db, PayPalEvent, Purchase, RecoveryCase } from "./types";

export const WEBHOOK_EVENTS = [
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.PENDING",
  "PAYMENT.CAPTURE.DENIED",
  "PAYMENT.CAPTURE.REFUNDED",
  "PAYMENT.CAPTURE.REVERSED",
  "PAYMENT.AUTHORIZATION.CREATED",
  "PAYMENT.AUTHORIZATION.VOIDED",
  "CUSTOMER.DISPUTE.CREATED",
  "CUSTOMER.DISPUTE.UPDATED",
  "CUSTOMER.DISPUTE.RESOLVED",
  "VAULT.PAYMENT-TOKEN.CREATED",
  "VAULT.PAYMENT-TOKEN.DELETED",
];

const KEEP = 200;

export const webhookUrl = (base = env.appUrl) => `${base}/api/paypal/webhook`;
/** PayPal only delivers to public https addresses, so a copy running on localhost has no webhook of its own. */
export const canReceiveWebhooks = (base = env.appUrl) => /^https:\/\//.test(base) && !/localhost|127\.0\.0\.1/.test(base);

export type WebhookState = { id: string; url: string; events: string[] };
let ready: WebhookState | null = null;
let pending: Promise<WebhookState | null> | null = null;

/** Make sure PayPal has this site's webhook with every event Minder listens for. Safe to call often. */
export function ensureWebhook(): Promise<WebhookState | null> {
  if (ready) return Promise.resolve(ready);
  if (!canReceiveWebhooks()) return Promise.resolve(null);
  pending ??= (async () => {
    const url = webhookUrl();
    const available = await listWebhookEventTypes().catch(() => WEBHOOK_EVENTS);
    const wanted = WEBHOOK_EVENTS.filter((e) => available.includes(e));
    let hook = (await listWebhooks()).find((h) => h.url === url);
    if (!hook) hook = await createWebhook(url, wanted);
    else if (wanted.some((e) => !hook!.event_types.some((t) => t.name === e))) hook = await setWebhookEvents(hook.id, wanted);
    ready = { id: hook.id, url, events: hook.event_types.map((t) => t.name) };
    log("paypal.webhook_ready", { url, events: ready.events.length });
    return ready;
  })().finally(() => {
    pending = null;
  });
  return pending;
}

// ---------- Reading an event ----------

type Amount = { value?: string; currency_code?: string };
type Link = { href?: string; rel?: string };
type Resource = {
  id?: string;
  status?: string;
  amount?: Amount;
  links?: Link[];
  supplementary_data?: { related_ids?: { order_id?: string; authorization_id?: string; capture_id?: string } };
  dispute_id?: string;
  dispute_amount?: Amount;
  dispute_life_cycle_stage?: string;
  dispute_outcome?: { outcome_code?: string; amount_refunded?: Amount };
  disputed_transactions?: { seller_transaction_id?: string }[];
};
export type RawEvent = { id?: string; event_type?: string; create_time?: string; summary?: string; resource?: Resource };

const dollars = (a?: Amount) => (a?.value ? usd(Number(a.value)) : "");
/** A refund or reversal links "up" to the capture it came from. */
const upCaptureId = (r: Resource) =>
  r.links?.find((l) => l.rel === "up" && l.href?.includes("/captures/"))?.href?.split("/captures/")[1]?.split(/[/?]/)[0];

function findPurchase(db: Db, ids: (string | undefined)[]): Purchase | undefined {
  const wanted = ids.filter(Boolean) as string[];
  if (!wanted.length) return undefined;
  return db.purchases.find((p) => [p.paypal.captureId, p.paypal.authorizationId, p.paypal.orderId].some((id) => id && wanted.includes(id)));
}


/**
 * Apply one verified event to the data: record it, link it to the purchase or case it is about,
 * and move a case or the saved PayPal permission forward. Returns null when the event was already applied.
 */
export function applyPayPalEvent(db: Db, e: RawEvent, receivedAt: string): PayPalEvent | null {
  if (!e.id || !e.event_type) throw new Error("Not a PayPal event.");
  db.paypalEvents ??= [];
  if (db.paypalEvents.some((x) => x.id === e.id)) return null;
  const r = e.resource ?? {};
  const at = demoNow(db).toISOString();
  let purchase: Purchase | undefined;
  let kase: RecoveryCase | undefined;
  let summary = e.summary ?? e.event_type;

  switch (e.event_type) {
    case "PAYMENT.CAPTURE.COMPLETED":
    case "PAYMENT.CAPTURE.PENDING":
    case "PAYMENT.CAPTURE.DENIED": {
      const rel = r.supplementary_data?.related_ids;
      purchase = findPurchase(db, [r.id, rel?.authorization_id, rel?.order_id]);
      const store = purchase?.request.merchant.name ?? "the store";
      summary =
        e.event_type === "PAYMENT.CAPTURE.COMPLETED"
          ? `PayPal confirmed ${dollars(r.amount)} was paid to ${store}.`
          : e.event_type === "PAYMENT.CAPTURE.PENDING"
            ? `PayPal is still processing the ${dollars(r.amount)} payment to ${store}.`
            : `PayPal denied the ${dollars(r.amount)} payment to ${store}. No money moved.`;
      break;
    }
    case "PAYMENT.CAPTURE.REFUNDED":
    case "PAYMENT.CAPTURE.REVERSED": {
      purchase = findPurchase(db, [upCaptureId(r), r.supplementary_data?.related_ids?.capture_id]);
      kase = purchase && db.cases.find((c) => c.purchaseId === purchase!.id);
      if (kase?.refund && kase.refund.refundId === r.id && r.status) kase.refund.status = r.status;
      summary =
        e.event_type === "PAYMENT.CAPTURE.REFUNDED"
          ? `PayPal confirmed ${dollars(r.amount)} was refunded to you.`
          : `PayPal took ${dollars(r.amount)} back from ${purchase?.request.merchant.name ?? "the store"} for you.`;
      break;
    }
    case "PAYMENT.AUTHORIZATION.CREATED":
    case "PAYMENT.AUTHORIZATION.VOIDED": {
      purchase = findPurchase(db, [r.id, r.supplementary_data?.related_ids?.order_id]);
      summary =
        e.event_type === "PAYMENT.AUTHORIZATION.CREATED"
          ? `PayPal is holding ${dollars(r.amount)} until you decide.`
          : `PayPal released the ${dollars(r.amount)} it was holding. Nothing was charged.`;
      break;
    }
    case "CUSTOMER.DISPUTE.CREATED":
    case "CUSTOMER.DISPUTE.UPDATED":
    case "CUSTOMER.DISPUTE.RESOLVED": {
      const disputeId = r.dispute_id;
      kase = db.cases.find((c) => c.dispute?.disputeId === disputeId);
      purchase = kase
        ? db.purchases.find((p) => p.id === kase!.purchaseId)
        : findPurchase(db, (r.disputed_transactions ?? []).map((t) => t.seller_transaction_id));
      kase ??= purchase && db.cases.find((c) => c.purchaseId === purchase!.id && c.status === "escalated");
      const resolved = e.event_type === "CUSTOMER.DISPUTE.RESOLVED" || r.status === "RESOLVED";
      const refunded = dollars(r.dispute_outcome?.amount_refunded) || dollars(r.dispute_amount);
      summary = resolved
        ? outcomeInWords(r.dispute_outcome?.outcome_code, refunded)
        : e.event_type === "CUSTOMER.DISPUTE.CREATED"
          ? `PayPal opened case ${disputeId} for ${dollars(r.dispute_amount)}.`
          : disputeInWords(r.status ?? "OTHER");
      if (kase && disputeId) {
        const before = kase.dispute?.status;
        kase.dispute = {
          ...kase.dispute,
          disputeId,
          status: r.status ?? before ?? "OPEN",
          stage: r.dispute_life_cycle_stage ?? kase.dispute?.stage,
          updatedAt: receivedAt,
          ...(resolved && {
            outcome: r.dispute_outcome?.outcome_code ?? "RESOLVED",
            amount: Number(r.dispute_outcome?.amount_refunded?.value ?? r.dispute_amount?.value ?? 0) || undefined,
          }),
        };
        // Minder already told the owner it opened the case, so only news goes into the conversation.
        const alreadyClosed = kase.status === "closed";
        if (!alreadyClosed && (resolved || before !== kase.dispute.status)) kase.messages.push({ from: "paypal", at, text: resolved ? summary : disputeInWords(kase.dispute.status) });
        if (resolved) kase.status = "closed";
      }
      break;
    }
    case "VAULT.PAYMENT-TOKEN.CREATED":
    case "VAULT.PAYMENT-TOKEN.DELETED": {
      const ours = Boolean(r.id && db.vault?.vaultId === r.id);
      if (e.event_type === "VAULT.PAYMENT-TOKEN.DELETED") {
        summary = ours
          ? "You removed Minder's permission to pay in your PayPal account. Minder will not pay for anything until you reconnect."
          : "PayPal removed a saved payment permission that this site was not using.";
        if (ours) db.vaultRevokedAt = receivedAt;
      } else {
        summary = "PayPal saved your permission for Minder to pay with your PayPal.";
        if (ours) delete db.vaultRevokedAt;
      }
      break;
    }
  }

  const event: PayPalEvent = {
    id: e.id,
    type: e.event_type,
    createdAt: e.create_time ?? receivedAt,
    receivedAt,
    summary,
    resourceId: r.dispute_id ?? r.id,
    ...(purchase && { purchaseId: purchase.id }),
    ...(kase && { caseId: kase.id }),
  };
  db.paypalEvents.unshift(event);
  db.paypalEvents.length = Math.min(db.paypalEvents.length, KEEP);
  return event;
}

// ---------- One delivery ----------

export type WebhookResult = { status: number; body: Record<string, unknown>; followUp?: () => Promise<void> };

/** Check a delivery with PayPal, then apply it. A failure PayPal can retry answers 5xx so PayPal sends it again. */
export async function receiveWebhook(raw: string, headers: WebhookHeaders): Promise<WebhookResult> {
  let event: RawEvent;
  try {
    event = JSON.parse(raw);
  } catch {
    return { status: 400, body: { error: "Not JSON." } };
  }
  if (!event.id || !event.event_type) return { status: 400, body: { error: "Not a PayPal event." } };
  if (!headers.transmissionSig || !headers.certUrl) return { status: 400, body: { error: "Missing PayPal signature headers." } };

  let hook: WebhookState | null;
  try {
    hook = await ensureWebhook();
  } catch (e) {
    log("paypal.webhook_setup_failed", { error: (e as Error).message });
    return { status: 503, body: { error: "Could not look up this site's PayPal webhook." } };
  }
  if (!hook) return { status: 404, body: { error: "This copy of Minder has no public address, so it has no PayPal webhook." } };

  let verified: boolean;
  try {
    verified = await verifyWebhookSignature(headers, hook.id, raw);
  } catch (e) {
    log("paypal.webhook_verify_failed", { id: event.id, error: (e as Error).message });
    return { status: 503, body: { error: "Could not reach PayPal to check the signature." } };
  }
  if (!verified) {
    log("paypal.webhook_rejected", { id: event.id, type: event.event_type });
    return { status: 400, body: { error: "PayPal did not confirm this signature." } };
  }

  const { applied, storeTurn } = await updateDb((db) => {
    const applied = applyPayPalEvent(db, event, new Date().toISOString());
    const c = applied?.caseId ? db.cases.find((x) => x.id === applied.caseId) : undefined;
    // PayPal passed the dispute to the store: the store's agent answers it on its own, after this reply.
    return { applied, storeTurn: c?.status === "escalated" && c.dispute?.status === "WAITING_FOR_SELLER_RESPONSE" ? c.id : undefined };
  });
  log("paypal.webhook", { id: event.id, type: event.event_type, purchase: applied?.purchaseId, case: applied?.caseId, duplicate: !applied });
  return {
    status: 200,
    body: { received: true, duplicate: !applied },
    followUp: storeTurn
      ? () =>
          storeAnswersCase(storeTurn).then(
            () => undefined,
            (e: Error) => log("store_agent.failed", { caseId: storeTurn, error: e.message }),
          )
      : undefined,
  };
}
