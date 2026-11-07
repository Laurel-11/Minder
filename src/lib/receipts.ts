// Minder's receipt book. Every decision Minder makes about the owner's money, and every step PayPal confirms, is
// written down as a receipt. Each receipt carries the fingerprint (SHA-256) of the receipt before it and Minder's
// signature (Ed25519). Changing, removing or reordering any receipt breaks the chain or a signature, and anyone can
// check that with the public key alone, offline: scripts/verify-receipts.mjs does it with plain Node.
//
// Receipts hold facts, not free text from stores: what a store's page said is kept with the purchase and the receipt
// holds its fingerprint, so the evidence can be checked without the book repeating whatever a page or visitor wrote.
import crypto from "node:crypto";
import { env } from "./env";
import { usd } from "./money";
import type { Db, Policy, Purchase, Receipt, ReceiptKind, RecoveryCase } from "./types";

export const RECEIPT_FORMAT = "minder-receipt-v1";
/** What the first receipt in a book points back to. */
export const GENESIS = "0".repeat(64);

/** JSON with every object's keys sorted and no spaces: the exact text a receipt's fingerprint is taken of. */
export function canonical(v: unknown): string {
  if (v === null || v === undefined || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
}

export const sha256 = (text: string) => crypto.createHash("sha256").update(text, "utf8").digest("hex");

// ---------- Minder's signing key ----------

export type PublicKey = { id: string; alg: "Ed25519"; x: string };
type SigningKey = PublicKey & { privateKey: crypto.KeyObject };

const PKCS8_ED25519 = Buffer.from("302e020100300506032b657004220420", "hex");
let current: SigningKey | null = null;

function keyFromSeed(seed: Uint8Array): SigningKey {
  const privateKey = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, Buffer.from(seed)]), format: "der", type: "pkcs8" });
  const x = (crypto.createPublicKey(privateKey).export({ format: "jwk" }) as { x: string }).x;
  return { id: crypto.createHash("sha256").update(Buffer.from(x, "base64url")).digest("hex").slice(0, 16), alg: "Ed25519", x, privateKey };
}

/**
 * The key is derived (HKDF-SHA256) from a server secret, so it survives restarts without being stored anywhere:
 * MINDER_RECEIPT_SECRET if set, otherwise the PayPal app secret. It never leaves the server. Without either
 * (tests, a copy with no keys), each start gets a fresh random key.
 */
function signingKey(): SigningKey {
  if (current) return current;
  const secret = process.env.MINDER_RECEIPT_SECRET || env.paypalClientSecret;
  const seed = secret ? Buffer.from(crypto.hkdfSync("sha256", secret, "minder-receipts", "ed25519 signing key v1", 32)) : crypto.randomBytes(32);
  current = keyFromSeed(seed);
  return current;
}

/** Tests only: sign with a key made from this seed (or go back to the normal key with null). */
export function useSigningSeed(seed: Uint8Array | null) {
  current = seed ? keyFromSeed(seed) : null;
}

export function publicKey(): PublicKey {
  const { id, alg, x } = signingKey();
  return { id, alg, x };
}

// ---------- Writing ----------

export type NewReceipt = { at: string; kind: ReceiptKind; purchaseId?: string; caseId?: string; says: string; facts: Record<string, unknown> };
type Body = Omit<Receipt, "hash" | "signer" | "sig">;

/** The fingerprint of a receipt: SHA-256 of its canonical form, without the fingerprint and signature themselves. */
export const fingerprint = (r: Body) =>
  sha256(canonical({ format: RECEIPT_FORMAT, n: r.n, at: r.at, kind: r.kind, purchaseId: r.purchaseId, caseId: r.caseId, says: r.says, facts: r.facts, prev: r.prev }));

function seal(body: Body): Receipt {
  const hash = fingerprint(body);
  const k = signingKey();
  return { ...body, hash, signer: k.id, sig: crypto.sign(null, Buffer.from(hash, "hex"), k.privateKey).toString("base64url") };
}

/** Add a receipt to the end of the owner's book. Call inside updateDb, so receipts are written one at a time. */
export function addReceipt(db: Db, r: NewReceipt): Receipt {
  const book = (db.receipts ??= []);
  const last = book.at(-1);
  const receipt = seal({
    n: (last?.n ?? 0) + 1,
    at: r.at,
    kind: r.kind,
    ...(r.purchaseId && { purchaseId: r.purchaseId }),
    ...(r.caseId && { caseId: r.caseId }),
    says: r.says,
    facts: JSON.parse(JSON.stringify(r.facts)) as Record<string, unknown>,
    prev: last?.hash ?? GENESIS,
  });
  book.push(receipt);
  return receipt;
}

/**
 * The sample story ships with its receipts. A fresh copy of the site signs them again with its own key: the
 * fingerprints, and so the chain and the fingerprints already on PayPal's orders, stay exactly as recorded.
 */
export function resealBook(book: Receipt[]): Receipt[] {
  return book.map(({ hash, signer, sig, ...body }) => {
    void signer;
    void sig;
    if (fingerprint(body) !== hash) throw new Error(`Receipt #${body.n} in the sample story does not match its fingerprint.`);
    return seal(body);
  });
}

// ---------- Checking ----------

export type ReceiptCheck = { n: number; contents: boolean; signature: boolean; knownSigner: boolean; chain: boolean };
export type BookCheck = { ok: boolean; count: number; lastHash: string; problems: { n: number; problem: string }[] };

const verifiers = new Map<string, crypto.KeyObject>();
function verifierFor(k: PublicKey) {
  let v = verifiers.get(k.x);
  if (!v) {
    v = crypto.createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: k.x }, format: "jwk" });
    verifiers.set(k.x, v);
  }
  return v;
}

/** Check one receipt: do its contents match its fingerprint, did Minder sign it, and does it point at `prevHash`? */
export function checkReceipt(r: Receipt, keys: PublicKey[] = [publicKey()], prevHash?: string): ReceiptCheck {
  let contents = false;
  try {
    contents = fingerprint(r) === r.hash;
  } catch {
    contents = false;
  }
  const key = keys.find((k) => k.id === r.signer);
  let signature = false;
  if (key && /^[0-9a-f]{64}$/.test(r.hash ?? "")) {
    try {
      signature = crypto.verify(null, Buffer.from(r.hash, "hex"), verifierFor(key), Buffer.from(String(r.sig), "base64url"));
    } catch {
      signature = false;
    }
  }
  return { n: r.n, contents, signature, knownSigner: Boolean(key), chain: prevHash === undefined || r.prev === prevHash };
}

/** Check a whole book from its first receipt: every fingerprint, every signature, and every link to the one before. */
export function checkBook(book: Receipt[], keys: PublicKey[] = [publicKey()]): BookCheck {
  const problems: BookCheck["problems"] = [];
  let prev = GENESIS;
  let expected = 1;
  for (const r of book) {
    if (r.n !== expected) problems.push({ n: r.n, problem: r.n > expected ? `Receipt #${expected} is missing.` : `Receipt #${r.n} is out of order.` });
    const c = checkReceipt(r, keys, prev);
    if (!c.contents) problems.push({ n: r.n, problem: `Receipt #${r.n} was changed after it was written.` });
    if (!c.knownSigner) problems.push({ n: r.n, problem: `Receipt #${r.n} was signed by a key this site does not use.` });
    else if (!c.signature) problems.push({ n: r.n, problem: `Receipt #${r.n} does not carry Minder's signature.` });
    if (!c.chain) problems.push({ n: r.n, problem: `Receipt #${r.n} does not point at the receipt before it.` });
    prev = r.hash;
    expected = r.n + 1;
  }
  return { ok: problems.length === 0, count: book.length, lastHash: prev, problems };
}

// ---------- What goes on each kind of receipt ----------

export function rulesReceipt(text: string, policy: Policy, at: string): NewReceipt {
  return { at, kind: "rules", says: `Your rules: "${text}"`, facts: { rulesText: text, policy } };
}

const fp = (text?: string) => sha256(text ?? "");

/** The fingerprints of the free text behind a decision, which stays with the purchase itself. */
export function decisionEvidence(p: Purchase) {
  return {
    pageText: fp(p.request.pageExcerpt),
    agentReason: fp(p.request.justification),
    aiFindings: fp(p.ai ? canonical({ instructionMatch: p.ai.instructionMatch, manipulationEvidence: p.ai.manipulationEvidence, summaryForOwner: p.ai.summaryForOwner }) : ""),
    reasons: fp(canonical(p.reasons)),
  };
}

/** The rule that decided, in its own words, or null when the AI review did. */
function firedRule(p: Purchase): string | null {
  const fired = p.rules.checks.find((c) => c.outcome === p.decision && c.outcome !== "approve");
  return fired ? fired.message.replace(/\.$/, "").replace(/^You /, "you ") : null;
}

function aiWhy(p: Purchase): string {
  if (p.aiError) return "the AI reviewer was unavailable";
  if (p.ai?.manipulationSuspected) return p.decision === "block" ? "the store's page steered the agent into something you did not ask for" : "the store's page tries to steer AI agents";
  if (p.ai && !p.ai.matchesInstruction) return "the AI review found it is not what you asked for";
  return "the AI review wants you to confirm it";
}

export function decisionReceipt(p: Purchase, rulesText = ""): NewReceipt {
  const where = `${usd(p.total)} at ${p.request.merchant.name}`;
  const rule = firedRule(p);
  const says =
    p.decision === "approve"
      ? `Minder approved ${where}: within your rules, and the AI review found it is what you asked for.`
      : p.decision === "hold"
        ? rule
          ? `Minder held ${where}: ${rule}.`
          : `Minder held ${where} for you to decide: ${aiWhy(p)}.`
        : `Minder blocked ${where}: ${rule ?? aiWhy(p)}.`;
  return {
    at: p.createdAt,
    kind: "decision",
    purchaseId: p.id,
    says,
    facts: {
      agent: p.request.agent,
      ownerAsked: p.request.ownerInstruction,
      ownerRules: rulesText,
      store: p.request.merchant.name,
      storePage: p.request.merchant.url ?? "",
      items: p.request.items.map((i) => ({ name: i.name, quantity: i.quantity, unitPrice: i.unitPrice, category: i.category })),
      total: p.total,
      currency: "USD",
      decision: p.decision,
      rules: p.rules.checks.map((c) => ({ rule: c.rule, outcome: c.outcome })),
      ai: p.ai
        ? { verdict: p.ai.verdict, model: p.ai.model, matchesRequest: p.ai.matchesInstruction, manipulationSuspected: p.ai.manipulationSuspected, recorded: Boolean(p.ai.recorded) }
        : null,
      aiUnavailable: Boolean(p.aiError),
      market: p.market
        ? {
            source: p.market.source,
            items: p.market.items.map((i) => ({ item: i.item, unitPrice: i.unitPrice, typical: i.typical, stores: i.stores, lowest: i.lowest && { store: i.lowest.store, price: i.lowest.price } })),
          }
        : null,
      evidence: decisionEvidence(p),
    },
  };
}

export function paypalReceipt(p: Purchase, at: string): NewReceipt {
  const store = p.request.merchant.name;
  const { orderId, captureId, authorizationId, error, receiptOnOrder } = p.paypal;
  const says = error
    ? `PayPal did not take the payment to ${store}, so no money moved.`
    : captureId
      ? `PayPal paid ${usd(p.total)} to ${store} (order ${orderId}, capture ${captureId}).`
      : `PayPal is holding ${usd(p.total)} for ${store} until you decide (order ${orderId}, authorization ${authorizationId}).`;
  return {
    at,
    kind: "paypal",
    purchaseId: p.id,
    says,
    facts: { orderId: orderId ?? null, intent: p.decision === "approve" ? "CAPTURE" : "AUTHORIZE", captureId: captureId ?? null, authorizationId: authorizationId ?? null, receiptOnOrder: receiptOnOrder ?? null, failed: error ?? null },
  };
}

export function ownerReceipt(p: Purchase): NewReceipt {
  const approved = p.owner?.decision === "approve";
  return {
    at: p.owner?.at ?? p.createdAt,
    kind: "owner",
    purchaseId: p.id,
    says: approved
      ? `You signed: PayPal sent the ${usd(p.total)} it was holding to ${p.request.merchant.name} (capture ${p.paypal.captureId}).`
      : `You declined: PayPal released the ${usd(p.total)} it was holding for ${p.request.merchant.name}. Nothing was paid.`,
    facts: { decision: p.owner?.decision ?? null, authorizationId: p.paypal.authorizationId ?? null, captureId: approved ? (p.paypal.captureId ?? null) : null },
  };
}

export function deliveryReceipt(p: Purchase, at: string): NewReceipt | null {
  const d = p.delivery;
  if (!d) return null;
  const store = p.request.merchant.name;
  const promised = new Date(d.promisedBy).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return {
    at: d.shippedAt ?? at,
    kind: "delivery",
    purchaseId: p.id,
    says:
      d.state === "shipped"
        ? `${store} shipped it with ${d.carrier} ${d.trackingNumber}${d.trackedInPayPal ? ", and the tracking number is on the PayPal order" : ""}.`
        : `${store} promised to ship it by ${promised}.`,
    facts: { state: d.state, promisedBy: d.promisedBy, carrier: d.carrier ?? null, trackingNumber: d.trackingNumber ?? null, trackedInPayPal: Boolean(d.trackedInPayPal) },
  };
}

const offerWords = (o?: { kind: string; amount: number }) =>
  !o || o.kind === "none" ? "nothing" : o.kind === "full_refund" ? `a full refund of ${usd(o.amount)}` : `${usd(o.amount)} back`;

/** Receipts this purchase already has, which a claim or a dispute cites as its evidence. */
export const citedReceipts = (db: Db, purchaseId: string) => (db.receipts ?? []).filter((r) => r.purchaseId === purchaseId).map((r) => ({ n: r.n, hash: r.hash }));

export function claimReceipt(c: RecoveryCase, p: Purchase, cites: { n: number; hash: string }[]): NewReceipt {
  const store = p.request.merchant.name;
  const offer = c.messages.filter((m) => m.from === "merchant").at(-1);
  return {
    at: c.createdAt,
    kind: "claim",
    purchaseId: p.id,
    caseId: c.id,
    says: `Minder claimed ${offerWords(c.askFor)} from ${store} because the order ${c.problem === "damaged" ? "arrived damaged" : "never shipped"}. ${store}'s agent offered ${offerWords(offer?.offer)}.`,
    facts: {
      problem: c.problem,
      openedBy: c.openedBy,
      askFor: c.askFor,
      storeOffer: offer?.offer ?? null,
      advice: c.recommendation?.action ?? null,
      evidence: { ownerNote: fp(c.ownerNote), claimLetter: fp(c.messages[0]?.text), storeReply: fp(offer?.text) },
      cites,
    },
  };
}

export function refundReceipt(c: RecoveryCase, p: Purchase, at: string): NewReceipt {
  return {
    at,
    kind: "refund",
    purchaseId: p.id,
    caseId: c.id,
    says: `You accepted, and ${p.request.merchant.name} refunded ${usd(c.refund?.amount ?? 0)} through PayPal (refund ${c.refund?.refundId}).`,
    facts: { refundId: c.refund?.refundId ?? null, amount: c.refund?.amount ?? 0, status: c.refund?.status ?? null, captureId: p.paypal.captureId ?? null },
  };
}

export function disputeReceipt(c: RecoveryCase, p: Purchase, at: string, cites: { n: number; hash: string }[], reasonCode: string): NewReceipt {
  const span = cites.length ? (cites.length === 1 ? `receipt #${cites[0].n}` : `receipts #${cites[0].n} to #${cites.at(-1)!.n}`) : "this book";
  return {
    at,
    kind: "dispute",
    purchaseId: p.id,
    caseId: c.id,
    says: `Minder took it to PayPal: dispute ${c.dispute?.disputeId} for ${usd(p.total)}, with ${span} as evidence.`,
    facts: { disputeId: c.dispute?.disputeId ?? null, amount: p.total, reasonCode, captureId: p.paypal.captureId ?? null, cites },
  };
}

export function disputeUpdateReceipt(c: RecoveryCase, at: string, says: string): NewReceipt {
  return {
    at,
    kind: "dispute_update",
    purchaseId: c.purchaseId,
    caseId: c.id,
    says,
    facts: { disputeId: c.dispute?.disputeId ?? null, status: c.dispute?.status ?? null, stage: c.dispute?.stage ?? null, outcome: c.dispute?.outcome ?? null, amount: c.dispute?.amount ?? null },
  };
}

/** The note Minder hands PayPal with a dispute, so PayPal's own case points at the signed evidence. */
export const evidenceTag = (cites: { n: number; hash: string }[]) => {
  const last = cites.at(-1);
  return last ? `[Minder receipt #${last.n} ${last.hash.slice(0, 16)}]` : "";
};

/** Does the free text kept with a purchase still match the fingerprints its decision receipt took? */
export function checkEvidence(p: Purchase, decision?: Receipt): { checked: boolean; matches: boolean; differs: string[] } {
  const recorded = (decision?.facts as { evidence?: Record<string, string> } | undefined)?.evidence;
  if (!recorded) return { checked: false, matches: false, differs: [] };
  const now = decisionEvidence(p) as Record<string, string>;
  const differs = Object.keys(recorded).filter((k) => recorded[k] !== now[k]);
  return { checked: true, matches: differs.length === 0, differs };
}

export const KIND_LABEL: Record<ReceiptKind, string> = {
  rules: "Rules",
  decision: "Minder decided",
  paypal: "PayPal",
  owner: "You decided",
  delivery: "Delivery",
  claim: "Claim",
  refund: "Refund",
  dispute: "PayPal dispute",
  dispute_update: "PayPal dispute",
  paypal_event: "PayPal confirmed",
  store_blocked: "Store blocked",
};
