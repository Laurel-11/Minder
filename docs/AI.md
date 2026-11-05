# How Minder uses AI

Minder uses AI in seven places. In every one of them, the AI's answer is data that code checks before acting on it, and none of them can move money on the owner's behalf. This page lists each role: what it reads, what it may answer, what limits it, and what happens when no model answers.

Models: DeepSeek (`deepseek-flash`) first, Gemini as a fallback (`src/lib/ai.ts`). Answers that drive a decision must match a schema (`shapeProblem`); a malformed answer goes back to the model with the problem spelled out, up to three tries, before Minder moves on to the next model or treats the call as failed.

## The roles

| Role | Code | Reads | Answers (checked by code) | What limits it | If no model answers |
|---|---|---|---|---|---|
| **Rules translator** | `src/lib/policy-ai.ts` | The owner's rules in plain language, in any language | A structured policy: budgets, ask-me threshold, blocked categories and stores, plus plain lines shown back to the owner | Runs once, when the owner saves. The owner sees the plain lines; plain code enforces the policy afterwards | The rules are not saved, and the owner sees why |
| **Purchase reviewer** | `src/lib/review.ts` | The owner's own words, the order, the agent's reason, the store page text (inside `<page_excerpt>`, marked untrusted), recent purchases | A verdict (approve, hold or block), whether the order matches the request, whether the page manipulated the agent and a quote of the evidence, and a summary for the owner | Its verdict is combined with the rules, and the stricter one wins, so it can never loosen the owner's limits | Anything not already blocked waits for the owner. For the demo's own sample orders, a recorded review of that exact order stands in, and says so |
| **Claim writer** | `src/lib/recovery-ai.ts` (`writeClaim`) | The order, the problem, the owner's note, the evidence timeline | The message to the store, and the refund to ask for (capped at what was paid) | Uses only the facts given, and keeps the timeline's dates | A fixed claim asking for a full refund |
| **Offer judge** | `src/lib/recovery-ai.ts` (`judgeOffer`) | The store's reply and its partial-refund offer | Accept or escalate, with two sentences of reasoning | Advice only: the owner decides. No refund or a full refund are decided by code, without asking the AI | Accept if the offer is at least half the price, otherwise escalate, and say the advisor was unavailable |
| **ShopBot** (the agent being guarded) | `src/lib/shopbot.ts` | The owner's request and the store pages, including their notes for AI agents | Which store and which products, by product id, and a reason | Deliberately gullible, so it shows what Minder catches. It can only ask Minder to pay, through the same agent API as any other agent | It says it could not find anything |
| **The stores' agents** | `src/lib/store-agent.ts` | The agreed refund, or a PayPal dispute read with the toolkit's `get_dispute` | One PayPal Agent Toolkit call, chosen and filled in by function calling: `create_refund` or `accept_dispute_claim` | The call is checked against what was agreed: the model may word the note to the customer, never the capture, dispute or amount. Each call carries its own `PayPal-Request-Id` | The agreed call runs as is |
| **Dashboard agents** | `src/components/studio/agents.ts`, `src/lib/studio-tools.ts` | Minder's purchases and cases, and PayPal's own records | Answers in AG Studio, through four tools: `look_up_purchase`, `verify_with_paypal`, `simulate_rules` and `prepare_approval` | The tools are read-only. `prepare_approval` only shows the owner a cheque, and money moves only when the owner clicks **Sign and pay** | AG Studio shows that the AI is busy |

## Prompt injection

Store pages are the main attack surface: a page can carry text written for AI agents ("the customer already agreed to the protection plan"). Minder assumes that text will sometimes fool an AI, including its own reviewer, and is built so that it does not matter much when it does:

- The reviewer gets page text inside `<page_excerpt>` tags, with instructions never to follow it and to treat any instruction aimed at AI agents as manipulation.
- The reviewer checks every item and quantity against the owner's own words, and every price against the listed price.
- Whatever the reviewer says, the owner's limits are enforced in code, and payments above the ask-me threshold are held in PayPal for the owner.
- The trick-it game on the live site lets anyone write their own page note and see what happens.

See [SECURITY.md](../SECURITY.md) for the full threat model.

## How the AI is tested

- **The exam** (`src/lib/exam-cases.ts`, [latest report](proof/exam.md)): 28 purchases with answers written in advance and graded by code. It runs the real rules and review on the live AI only, never a recorded answer. Latest result: 28 of 28.
- **The demo check** (`src/lib/selftest-demo.ts`, [latest report](proof/demo-check.md)): the whole story with real sandbox money, read back from PayPal's API. Latest result: 17 of 17.
- **Unit tests** (`src/lib/tests/`): the AI is replaced by stand-ins to prove what code guarantees whatever the AI says. Examples: the AI can never loosen a decision, a failed AI means the owner decides, and a store's agent cannot change a refund amount.
