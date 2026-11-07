export type Money = { currency_code: string; value: string };

export const CATEGORIES = [
  "groceries",
  "food_delivery",
  "household",
  "electronics",
  "clothing",
  "gifts",
  "gift_cards",
  "travel",
  "subscriptions",
  "entertainment",
  "health",
  "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export type Period = "day" | "week" | "month";

/** Structured spending rules. Enforced by plain code, never by the AI. */
export type Policy = {
  currency: "USD";
  /** Purchases above this amount are held until the owner approves. */
  approvalThreshold: number;
  /** Purchases above this amount are always blocked. */
  perPurchaseMax: number | null;
  /** Spending limits over a rolling window. An empty category list means all spending. */
  budgets: { label: string; categories: Category[]; period: Period; limit: number }[];
  blockedCategories: Category[];
  blockedMerchants: string[];
  /** Why the owner blocked a store, keyed by the blocked-list entry in lower case. Set when a store is blocked from a recovery case. */
  blockedMerchantNotes?: Record<string, string>;
  /** Plain-English lines shown back to the owner. */
  explanation: string[];
};

export type VaultInfo = { vaultId: string; customerId?: string; savedAt: string };

export type Outcome = "approve" | "hold" | "block";

export type LineItem = { name: string; unitPrice: number; quantity: number; category: Category };

/** What an AI shopping agent sends when it wants to spend the owner's money. */
export type PurchaseRequest = {
  agent: string;
  /** The owner's own words to the agent, e.g. "buy me a bag of coffee beans". */
  ownerInstruction: string;
  merchant: { name: string; url?: string };
  items: LineItem[];
  currency: "USD";
  /** The agent's explanation of why it is buying this. */
  justification: string;
  /** Text the agent read on the merchant's page. Untrusted. */
  pageExcerpt?: string;
};

export type RuleCheck = { rule: string; outcome: Outcome; message: string };

export type AiReview = {
  verdict: Outcome;
  matchesInstruction: boolean;
  instructionMatch: string;
  manipulationSuspected: boolean;
  manipulationEvidence: string;
  riskFlags: string[];
  summaryForOwner: string;
  model: string;
  /** True when the live AI was unavailable and this is its recorded review of the same order. */
  recorded?: boolean;
};

export type MarketOffer = { title: string; store: string; price: number; url: string };
/** What other stores charge for one item, from Channel3's product catalog (see market.ts). */
export type ItemMarket = {
  item: string;
  unitPrice: number;
  /** Offers from products that match the item, in US dollars, cheapest first. */
  offers: MarketOffer[];
  /** The median price of those offers, or null when there are too few to call it a market price. */
  typical: number | null;
  lowest: MarketOffer | null;
  /** The highest of those prices: with `lowest`, the range shown to the owner. */
  highest: number | null;
  stores: number;
};
export type MarketCheck = { source: "Channel3"; checkedAt: string; items: ItemMarket[] };

export type PurchaseStatus =
  | "paid"
  | "awaiting_owner"
  | "approved_by_owner"
  | "declined_by_owner"
  | "blocked"
  | "payment_failed";

export type DeliveryState = "awaiting_shipment" | "shipped" | "delivered";

export type Delivery = {
  state: DeliveryState;
  /** When the store promised to ship by. */
  promisedBy: string;
  shippedAt?: string;
  carrier?: string;
  trackingNumber?: string;
  /** True once the tracking number is registered on the PayPal order. */
  trackedInPayPal?: boolean;
  /** How the item will arrive (demo stores behave differently). Revealed when the owner reports it. */
  arrivesDamaged?: boolean;
};

export type Purchase = {
  id: string;
  createdAt: string;
  request: PurchaseRequest;
  total: number;
  rules: { outcome: Outcome; checks: RuleCheck[] };
  ai: AiReview | null;
  aiError?: string;
  /** What other stores charge for the same items, looked up before deciding. */
  market?: MarketCheck;
  decision: Outcome;
  reasons: string[];
  status: PurchaseStatus;
  /** receiptOnOrder: the fingerprint of Minder's decision receipt, written on the PayPal order as its custom_id. */
  paypal: { orderId?: string; authorizationId?: string; captureId?: string; error?: string; receiptOnOrder?: string };
  owner?: { decision: "approve" | "decline"; at: string };
  delivery?: Delivery;
  /** "trick": made on the trick-it page with a visitor's own store note. Kept out of shared lists and totals. */
  source?: "trick";
};

export type CaseProblem = "not_delivered" | "damaged";
export type Offer = { kind: "full_refund" | "partial_refund" | "none"; amount: number };

export type CaseMessage = {
  from: "minder" | "merchant" | "paypal" | "owner";
  at: string;
  text: string;
  offer?: Offer;
};

export type RecoveryCase = {
  id: string;
  purchaseId: string;
  createdAt: string;
  problem: CaseProblem;
  openedBy: "minder" | "owner";
  ownerNote?: string;
  timeline: { at: string; event: string }[];
  askFor: Offer;
  messages: CaseMessage[];
  recommendation?: { action: "accept" | "escalate"; reasoning: string; model?: string };
  status: "offer_to_review" | "refunded" | "escalated" | "closed";
  refund?: { refundId: string; amount: number; status: string };
  dispute?: {
    disputeId: string;
    status: string;
    stage?: string;
    updatedAt: string;
    /** PayPal's final decision, from the CUSTOMER.DISPUTE.RESOLVED webhook (e.g. RESOLVED_BUYER_FAVOUR). */
    outcome?: string;
    amount?: number;
  };
};

/** A notification PayPal sent to Minder's webhook, kept after PayPal confirmed its signature. */
export type PayPalEvent = {
  id: string;
  type: string;
  /** When PayPal created the event. */
  createdAt: string;
  receivedAt: string;
  /** What happened, in the owner's words. */
  summary: string;
  resourceId?: string;
  purchaseId?: string;
  caseId?: string;
};

export type ReceiptKind = "rules" | "decision" | "paypal" | "owner" | "delivery" | "claim" | "refund" | "dispute" | "dispute_update" | "paypal_event" | "store_blocked";

/** One entry in Minder's receipt book (see receipts.ts): what happened, chained to the entry before and signed. */
export type Receipt = {
  /** Position in the book, from 1. */
  n: number;
  at: string;
  kind: ReceiptKind;
  purchaseId?: string;
  caseId?: string;
  /** One plain sentence, written by Minder's code. */
  says: string;
  facts: Record<string, unknown>;
  /** The fingerprint of receipt n-1 (64 zeros for the first). */
  prev: string;
  /** SHA-256 of this receipt's canonical form. */
  hash: string;
  /** Which public key signed it. */
  signer: string;
  /** Ed25519 signature of the fingerprint, base64url. */
  sig: string;
};

export type Db = {
  version: 1;
  owner: { name: string };
  vault?: VaultInfo;
  rulesText?: string;
  policy?: Policy;
  purchases: Purchase[];
  cases: RecoveryCase[];
  /** Demo time travel: days added to the real clock so a late delivery can be shown without waiting. */
  demoClockDays?: number;
  pendingSetupTokens: { id: string; createdAt: string }[];
  /** Newest first: what PayPal's webhooks told Minder. */
  paypalEvents?: PayPalEvent[];
  /** Scores for the trick-it page. */
  trickBoard?: { attempts: number; fooled: number; caught: number; slipped: number; paidOnSlips: number };
  /** Set when PayPal reports that Maya removed Minder's saved payment permission. Minder pays nothing until she reconnects. */
  vaultRevokedAt?: string;
  /** Oldest first: Minder's receipt book. */
  receipts?: Receipt[];
};
