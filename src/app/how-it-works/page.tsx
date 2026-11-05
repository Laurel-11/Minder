import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How Minder works",
  description: "Why AI agents need their own buyer protection, and how Minder provides it on PayPal.",
};

const REPO = "https://github.com/Laurel-11/Minder";

const GAP = [
  { risk: "A store page tricks the agent into extra items, more units or a different product", paypal: "Usually not covered: the order arrives as described", minder: "Blocked before PayPal is asked to pay" },
  { risk: "The agent overspends", paypal: "Not a Buyer Protection case: the payment was authorized", minder: "Your limits, enforced in code; over your threshold, PayPal holds the money until you approve" },
  { risk: "The agent buys a gift card", paypal: "Gift cards are not eligible", minder: "Never paid, by your rule" },
  { risk: "The order never arrives", paypal: "Covered: Item Not Received", minder: "Noticed, claimed, negotiated, and escalated to a PayPal dispute" },
  { risk: "It arrives damaged", paypal: "Covered: Significantly Not as Described", minder: "Claim filed with evidence; you choose the refund or the dispute" },
];

type Step = { title: string; body: string; api?: string; tone?: "approve" | "hold" | "block" };
const STAGES: { name: string; steps: Step[] }[] = [
  {
    name: "Before the money moves",
    steps: [
      { title: "An agent asks to pay", body: "ShopBot, or any agent connected over MCP. Agents can only ask." },
      { title: "Your rules, in code", body: "Budgets, the ask-me threshold, blocked stores and gift cards. No prompt can change them." },
      { title: "AI review", body: "Compares the order with your own words and the store page, which it treats as untrusted. It can only make a decision stricter." },
    ],
  },
  {
    name: "When it moves",
    steps: [
      { title: "Approve: PayPal pays", body: "Paid at once from the PayPal you connected once.", api: "Vault v3, Orders v2 CAPTURE", tone: "approve" },
      { title: "Hold: PayPal holds it", body: "The money is reserved, not taken. You tap Pay or Decline.", api: "Orders v2 AUTHORIZE, then capture or void", tone: "hold" },
      { title: "Block: nothing is sent", body: "No PayPal order exists, and you see why.", tone: "block" },
    ],
  },
  {
    name: "After it moves",
    steps: [
      { title: "PayPal reports back", body: "Payments, refunds and dispute changes arrive as notifications, each checked with PayPal.", api: "Webhooks, verify-webhook-signature" },
      { title: "Minder chases problems", body: "A late or damaged order gets a claim with an evidence timeline." },
      { title: "The store's agent answers", body: "It refunds or accepts the dispute through PayPal's own agent tools.", api: "PayPal Agent Toolkit" },
      { title: "You decide", body: "Accept the offer (a PayPal refund) or escalate (a PayPal dispute), then block the store.", api: "Payments v2 refund, Disputes v1" },
    ],
  },
];

const PRINCIPLES = [
  { title: "The AI never touches the money", body: "Only Minder's server code calls PayPal. Agents cannot capture a hold, accept a refund or escalate a dispute." },
  { title: "You approve the risky ones", body: "Above your threshold, or when the review is unsure, PayPal holds the money until you decide." },
  { title: "Store pages are untrusted", body: "Page text that tries to steer an AI agent counts as manipulation: the purchase is blocked or held." },
  { title: "Code checks the AI", body: "Every AI answer must match a schema, and the stricter of your rules and the AI's view wins." },
  { title: "No AI, no payment", body: "If no model answers, anything not already blocked waits for you." },
];

const SOURCES = [
  {
    who: "Guardio Labs, August 2025",
    what: "Asked to buy an Apple Watch, an AI browser bought one from a fake store and filled in the saved card, without asking.",
    href: "https://guard.io/labs/scamlexity-we-put-agentic-ai-browsers-to-the-test-they-clicked-they-paid-they-failed",
  },
  {
    who: "Microsoft Research, November 2025",
    what: "In a simulated marketplace, prompt injection redirected AI agents' payments to manipulative sellers. The researchers' conclusion: oversight is critical for high-stakes transactions.",
    href: "https://www.theregister.com/2025/11/06/microsoft_unveils_the_magentic_marketplace/",
  },
  {
    who: "PayPal, October 2025",
    what: "PayPal launched agentic commerce services so merchants can take payments from AI agents, with buyer protection and dispute resolution on the merchant side.",
    href: "https://newsroom.paypal-corp.com/2025-10-28-PayPal-Launches-Agentic-Commerce-Services-to-Power-AI-Driven-Shopping",
  },
  {
    who: "OWASP, 2025",
    what: "Prompt injection is the top risk for LLM applications, with no fool-proof fix. Recommended: least privilege, human approval for risky actions, separating untrusted content, and checking output in code.",
    href: "https://genai.owasp.org/llmrisk/llm01-prompt-injection/",
  },
];

const TONE = { approve: "border-approve text-approve", hold: "border-hold text-hold", block: "border-block text-block" } as const;

export default function HowItWorksPage() {
  return (
    <div className="flex flex-col gap-12">
      <section>
        <h1 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">How Minder works</h1>
        <p className="mt-4 max-w-prose text-[15px] leading-relaxed">
          PayPal Buyer Protection covers an order that never arrives or is not as described. It was built for people, who notice problems after delivery. An AI agent&apos;s
          worst losses happen earlier: a store page talks it into an order you never wanted, and that order arrives exactly as described. PayPal&apos;s terms exclude an item
          that was properly described but that you did not want (
          <a href="https://www.paypal.com/us/legalhub/buyer-protection" className="underline underline-offset-2">
            Buyer Protection
          </a>
          ). Minder stops those orders before the money moves, and files the claims PayPal does cover.
        </p>
      </section>

      <section aria-labelledby="gap" className="flex flex-col gap-3">
        <h2 id="gap" className="text-xl font-semibold tracking-tight">
          Where the gap is
        </h2>
        <div className="overflow-hidden rounded-lg border border-line bg-paper text-sm">
          <div className="hidden grid-cols-[1.4fr_1fr_1fr] gap-4 border-b border-line bg-canvas px-4 py-2 text-xs font-medium text-muted sm:grid">
            <span>What goes wrong</span>
            <span>PayPal Buyer Protection</span>
            <span>Minder</span>
          </div>
          {GAP.map((g, n) => (
            <div key={n} className="grid gap-1 border-b border-line px-4 py-3 last:border-b-0 sm:grid-cols-[1.4fr_1fr_1fr] sm:gap-4">
              <span className="font-medium">{g.risk}</span>
              <span className="text-muted">
                <span className="sm:hidden">PayPal: </span>
                {g.paypal}
              </span>
              <span>
                <span className="text-muted sm:hidden">Minder: </span>
                {g.minder}
              </span>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted">PayPal decides each claim itself; the middle column summarizes its published terms.</p>
      </section>

      <section aria-labelledby="flow" className="flex flex-col gap-4">
        <div>
          <h2 id="flow" className="text-xl font-semibold tracking-tight">
            One purchase, from request to recovery
          </h2>
          <p className="mt-1 max-w-prose text-sm text-muted">Each step names the PayPal API it uses. Everything here runs on the live site, in the PayPal sandbox.</p>
        </div>
        <ol className="grid gap-6 sm:grid-cols-3 sm:gap-0 sm:divide-x sm:divide-line">
          {STAGES.map((stage, s) => (
            <li key={stage.name} className="flex flex-col gap-3 sm:px-4 sm:first:pl-0 sm:last:pr-0">
              <p className="text-sm font-semibold">
                <span className="mr-2 inline-grid h-6 w-6 place-items-center rounded-full bg-ink text-xs text-paper">{s + 1}</span>
                {stage.name}
              </p>
              <ol className="relative flex flex-col gap-3 border-l-2 border-line pl-4">
                {stage.steps.map((step) => (
                  <li key={step.title} className={`rounded-md border bg-paper px-3 py-2.5 ${step.tone ? TONE[step.tone] : "border-line"}`}>
                    <p className={`text-sm font-medium ${step.tone ? "" : "text-ink"}`}>{step.title}</p>
                    <p className="mt-0.5 text-[13px] leading-snug text-ink">{step.body}</p>
                    {step.api && <p className="mt-1.5 text-xs text-muted">PayPal: {step.api}</p>}
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="safe" className="flex flex-col gap-3">
        <h2 id="safe" className="text-xl font-semibold tracking-tight">
          What keeps it safe
        </h2>
        <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
          {PRINCIPLES.map((p) => (
            <div key={p.title}>
              <dt className="font-medium">{p.title}</dt>
              <dd className="mt-0.5 text-sm text-muted">{p.body}</dd>
            </div>
          ))}
        </dl>
        <p className="text-sm">
          Every threat, its defence and its test are listed in{" "}
          <a href={`${REPO}/blob/main/SECURITY.md`} className="underline underline-offset-2">
            the threat model
          </a>
          , and every AI role in{" "}
          <a href={`${REPO}/blob/main/docs/AI.md`} className="underline underline-offset-2">
            how Minder uses AI
          </a>
          .
        </p>
      </section>

      <section aria-labelledby="why" className="flex flex-col gap-3">
        <h2 id="why" className="text-xl font-semibold tracking-tight">
          Why this matters now
        </h2>
        <ul className="flex flex-col gap-4">
          {SOURCES.map((s) => (
            <li key={s.href} className="text-sm">
              <a href={s.href} className="font-medium underline underline-offset-2">
                {s.who}
              </a>
              <p className="mt-0.5 max-w-prose text-muted">{s.what}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-wrap gap-x-6 gap-y-2 border-t border-line pt-6 text-sm">
        <Link href="/agent" className="underline underline-offset-2">
          Try ShopBot, or try to trick it
        </Link>
        <a href={REPO} className="underline underline-offset-2">
          Source code and README
        </a>
        <a href={`${REPO}/tree/main/docs/proof`} className="underline underline-offset-2">
          Latest test reports
        </a>
      </section>
    </div>
  );
}
