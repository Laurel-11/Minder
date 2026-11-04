// Thin client for the PayPal REST APIs Minder uses (sandbox only): orders, vault, payments, tracking, disputes, lookups.
import crypto from "node:crypto";
import { env } from "./env";
import { fetchWithTimeout, sleep } from "./http";
import { log } from "./log";
import type { Money } from "./types";

const BASE = "https://api-m.sandbox.paypal.com";

export class PayPalError extends Error {
  constructor(message: string, public status: number, public body: unknown, public debugId: string | null) {
    super(message);
  }
}

type Link = { href: string; rel: string; method?: string };
type Json = Record<string, unknown>;

let cachedToken: { token: string; expiresAt: number } | null = null;

export async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;
  const basic = Buffer.from(`${env.paypalClientId}:${env.paypalClientSecret}`).toString("base64");
  const res = await fetchWithTimeout(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const json = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !json.access_token) {
    throw new PayPalError(`PayPal rejected the app credentials (${json.error ?? res.status})`, res.status, json, null);
  }
  cachedToken = { token: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 300) * 1000 };
  return cachedToken.token;
}

function describe(status: number, body: unknown): string {
  const b = (body ?? {}) as { name?: string; message?: string; details?: { issue?: string; description?: string }[] };
  const issue = b.details?.[0]?.issue;
  return [`PayPal ${status}`, b.name, issue, b.details?.[0]?.description ?? b.message].filter(Boolean).join(" · ");
}

/** PayPal answers these when a retry is safe: busy, rate limited, or still working on the same request. */
const retryable = (status: number, body: unknown) =>
  status === 429 || status >= 500 || (status === 409 && JSON.stringify(body ?? "").includes("PREVIOUS_REQUEST_IN_PROGRESS"));

/**
 * One PayPal call. Writes carry a PayPal-Request-Id: pass a key derived from what is being done
 * (e.g. "<authorization id>:capture"), so the same action can never run twice, whether we retry it
 * here after a timeout or the owner double-clicks. Busy answers are retried with the same key.
 */
async function call<T = Json>(method: string, path: string, opts: { body?: unknown; idempotent?: boolean | string } = {}): Promise<T> {
  const requestId = typeof opts.idempotent === "string" ? opts.idempotent : opts.idempotent ? crypto.randomUUID() : undefined;
  for (let attempt = 1; ; attempt++) {
    const token = await getAccessToken();
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    if (requestId) headers["PayPal-Request-Id"] = requestId;
    let res: Response;
    try {
      res = await fetchWithTimeout(BASE + path, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
    } catch (e) {
      // A timeout may have reached PayPal: only a request with a stable key can safely go again.
      if ((method === "GET" || requestId) && attempt < 4) {
        await sleep(1000 * 2 ** (attempt - 1));
        continue;
      }
      throw e;
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    const debugId = res.headers.get("paypal-debug-id");
    if (!res.ok) {
      const message = describe(res.status, json);
      log("paypal.error", { method, path: path.split("?")[0], status: res.status, debugId, message, attempt });
      if (retryable(res.status, json) && (method === "GET" || requestId) && attempt < 4) {
        await sleep(1000 * 2 ** (attempt - 1));
        continue;
      }
      throw new PayPalError(message, res.status, json, debugId);
    }
    log("paypal.ok", { method, path: path.split("?")[0], status: res.status, ...(attempt > 1 && { attempt }) });
    return json as T;
  }
}

// ---------- Vault: Maya approves once, Minder can pay later ----------

export async function createVaultSetupToken(returnUrl: string, cancelUrl: string) {
  const r = await call<{ id: string; links: Link[] }>("POST", "/v3/vault/setup-tokens", {
    idempotent: true,
    body: {
      payment_source: {
        paypal: {
          description: "Minder: let your AI shopping agent pay with PayPal, under your rules",
          permit_multiple_payment_tokens: false,
          usage_pattern: "IMMEDIATE",
          usage_type: "MERCHANT",
          customer_type: "CONSUMER",
          experience_context: {
            brand_name: "Minder",
            locale: "en-US",
            shipping_preference: "NO_SHIPPING",
            return_url: returnUrl,
            cancel_url: cancelUrl,
          },
        },
      },
    },
  });
  const approveUrl = r.links.find((l) => l.rel === "approve")?.href;
  if (!approveUrl) throw new PayPalError("PayPal did not return an approval link", 500, r, null);
  return { setupTokenId: r.id, approveUrl };
}

export async function createPaymentToken(setupTokenId: string) {
  const r = await call<{ id: string; customer?: { id: string } }>("POST", "/v3/vault/payment-tokens", {
    idempotent: `${setupTokenId}:payment-token`,
    body: { payment_source: { token: { id: setupTokenId, type: "SETUP_TOKEN" } } },
  });
  return { vaultId: r.id, customerId: r.customer?.id };
}

// ---------- Orders: pay now, or hold the money until the owner decides ----------

type OrderResponse = {
  id: string;
  status: string;
  purchase_units?: {
    payments?: {
      authorizations?: { id: string; status: string }[];
      captures?: { id: string; status: string }[];
    };
  }[];
};

export type VaultedOrderResult = {
  orderId: string;
  status: string;
  authorizationId?: string;
  captureId?: string;
};

/**
 * Charge Maya's saved PayPal without asking her to log in.
 * intent CAPTURE = pay now; intent AUTHORIZE = hold the money (like a hotel deposit).
 */
export async function createVaultedOrder(input: {
  vaultId: string;
  intent: "CAPTURE" | "AUTHORIZE";
  amount: Money;
  description: string;
  referenceId?: string;
}): Promise<VaultedOrderResult> {
  let order = await call<OrderResponse>("POST", "/v2/checkout/orders", {
    idempotent: input.referenceId ? `${input.referenceId}:order` : true,
    body: {
      intent: input.intent,
      purchase_units: [
        {
          reference_id: input.referenceId,
          description: input.description.slice(0, 127),
          amount: input.amount,
        },
      ],
      payment_source: { paypal: { vault_id: input.vaultId } },
    },
  });
  let payments = order.purchase_units?.[0]?.payments;
  if (input.intent === "AUTHORIZE" && !payments?.authorizations?.length) {
    order = await call<OrderResponse>("POST", `/v2/checkout/orders/${order.id}/authorize`, { idempotent: `${order.id}:authorize`, body: {} });
    payments = order.purchase_units?.[0]?.payments;
  }
  return {
    orderId: order.id,
    status: order.status,
    authorizationId: payments?.authorizations?.[0]?.id,
    captureId: payments?.captures?.[0]?.id,
  };
}

export async function captureAuthorization(authorizationId: string) {
  const r = await call<{ id: string; status: string }>("POST", `/v2/payments/authorizations/${authorizationId}/capture`, {
    idempotent: `${authorizationId}:capture`,
    body: { final_capture: true },
  });
  return { captureId: r.id, status: r.status };
}

export async function voidAuthorization(authorizationId: string) {
  await call("POST", `/v2/payments/authorizations/${authorizationId}/void`, { idempotent: `${authorizationId}:void` });
}

export async function refundCapture(captureId: string, amount: Money, noteToPayer: string) {
  const r = await call<{ id: string; status: string }>("POST", `/v2/payments/captures/${captureId}/refund`, {
    idempotent: `${captureId}:refund:${amount.value}`,
    body: { amount, note_to_payer: noteToPayer.slice(0, 255) },
  });
  return { refundId: r.id, status: r.status };
}

// ---------- Lookups: PayPal's own records, used by the self-test as the outside judge ----------

export const getOrder = (orderId: string) => call<Json>("GET", `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
export const getRefund = (refundId: string) => call<Json>("GET", `/v2/payments/refunds/${encodeURIComponent(refundId)}`);

// ---------- Shipping ----------

/** Register a shipment's tracking number on the PayPal order, so PayPal (and Buyer Protection) can see it. */
export async function addTracking(input: { orderId: string; captureId: string; trackingNumber: string; carrier: string }) {
  await call("POST", `/v2/checkout/orders/${input.orderId}/track`, {
    idempotent: `${input.orderId}:track:${input.trackingNumber}`,
    body: { capture_id: input.captureId, tracking_number: input.trackingNumber, carrier: input.carrier, notify_payer: false },
  });
}

// ---------- Disputes ----------

export type DisputeSummary = {
  dispute_id: string;
  status: string;
  reason?: string;
  dispute_life_cycle_stage?: string;
  dispute_amount?: Money;
  links?: Link[];
};

export async function listDisputes() {
  const r = await call<{ items?: DisputeSummary[] }>("GET", "/v1/customer/disputes?page_size=20");
  return r.items ?? [];
}

export async function getDispute(disputeId: string) {
  return call<DisputeSummary & Json>("GET", `/v1/customer/disputes/${disputeId}`);
}

/** Merchant side: accept the buyer's claim, which tells PayPal to refund the buyer. */
export async function acceptClaim(disputeId: string, note: string) {
  await call("POST", `/v1/customer/disputes/${disputeId}/accept-claim`, { body: { note: note.slice(0, 2000) } });
}

/**
 * Sandbox only: PayPal's chargeback simulator. Used to escalate a case to PayPal in the demo,
 * because the sandbox does not let a third-party app open a dispute in the buyer's name.
 */
/** Visa reason codes: 13.1 merchandise not received, 13.3 not as described or defective. */
export const CHARGEBACK_REASON = { not_delivered: "1310", damaged: "1330" } as const;

export async function simulateChargeback(input: { captureId: string; amount: Money; note: string; reasonCode?: string }) {
  const now = new Date();
  const r = await call<{ dispute_id?: string }>("POST", "/v2/customer-support/process-chargeback", {
    body: {
      adjacency: "PAYPAL",
      file_layout: "ATCK_CB",
      financial_institution: { processor: "FDMS" },
      transaction: { id_enc: input.captureId, amount: input.amount },
      instrument: { instrument_type: "CARD", card_brand: "VISA", credit_card_transaction_id: String(Date.now()).padEnd(16, "7"), external: false },
      dispute: {
        id: null,
        stage: "CHARGEBACK",
        response_date: new Date(now.getTime() + 10 * 86_400_000).toISOString(),
        status: "2",
        amount: input.amount,
        receive_date: now.toISOString(),
        event_code: "CHARGEBACK_INITIATED",
        money_movement_date: now.toISOString(),
        event_type: "DEBIT",
        chargeback_type: "REPORTED_TO_PROCESSOR",
        processor_info: { reference_number: `${Date.now()}000000000`, reason_code: input.reasonCode ?? "1330", notes: input.note.slice(0, 200) },
      },
    },
  });
  return { disputeId: r.dispute_id };
}
