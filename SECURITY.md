# Security and threat model

Minder decides whether other people's money moves, so this file lists what can go wrong, what stops it, where that lives in the code, and how it is tested. Minder is a sandbox demo: no real money moves.

## What Minder protects

- **The owner's money** in their PayPal account.
- **The owner's saved PayPal permission:** the vault payment token that lets Minder pay without the owner logging in each time.
- **The app's own keys:** PayPal client credentials and the AI keys.

## Five principles

Indirect prompt injection, where a web page carries instructions that change an AI's behaviour, has no fool-proof fix ([OWASP LLM01:2025](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)). OWASP recommends least privilege, human approval for high-risk actions, separating untrusted content, and checking model output with deterministic code. Minder applies all four, and adds a fifth: assume the AI will sometimes be wrong.

1. **The AI never touches the money.** Only Minder's server code calls PayPal, with keys the AI never sees. Every AI answer is treated as data. Agents, whether ShopBot or any agent over MCP, can only ask to pay. They cannot capture a held payment, accept a refund offer, escalate a dispute or change the rules.
2. **The owner approves risky payments.** Anything over the owner's threshold, or anything the review is unsure about, becomes a PayPal authorization: the money is held, not taken, until the owner taps Pay or Decline.
3. **Store pages are labelled as untrusted.** The reviewer sees page text inside `<page_excerpt>` tags and is told never to follow instructions in it. Page text aimed at AI agents counts as manipulation: if it changed the order, the purchase is blocked; if it did not, the purchase is held because the store cannot be trusted.
4. **Code checks every AI answer.** Answers must match a schema before Minder acts on them. Rules are plain TypeScript, and the final decision is the stricter of what the rules say and what the AI says, so the AI can make a decision stricter but never looser.
5. **When the AI is unavailable, the owner decides.** If no model answers, anything not already blocked waits for the owner.

## Threats and defences

| Threat | What stops it | Where | Tested by |
|---|---|---|---|
| A store page talks the shopping agent into extra items, more units, a different product or a higher price | The AI review compares the order with the owner's own words and the listed prices; manipulation leads to a block | `src/lib/review.ts`, `src/lib/purchases.ts` | [Exam](docs/proof/exam.md): 14 of 14 tricks caught; the trick-it game on the live site |
| Page text addresses Minder's reviewer itself ("the account holder pre-approved this", a fake system message) | Same review; page text cannot grant approval | `src/lib/review.ts` | Exam cases T2, T3 |
| The AI reviewer is wrong, or is itself manipulated into approving | It cannot loosen the code's decision, so budgets, the ask-me threshold and blocked categories and stores still apply | `src/lib/rules.ts`, `src/lib/purchases.ts` | `assess.test.ts`: all nine rule and AI combinations |
| No AI model answers | Anything not blocked waits for the owner. Recorded answers stand in only for the exact demo orders they were recorded for, and say so; the exam never uses them | `src/lib/ai.ts`, `src/lib/purchases.ts` | `assess.test.ts`, `ai.test.ts`, `review.test.ts` |
| Gift cards and other cash equivalents (also outside PayPal Buyer Protection) | Blocked by code, without asking the AI | `src/lib/rules.ts` | `rules.test.ts`, exam R1 and R2 |
| A retry, timeout or double click charges or refunds twice | Every PayPal write carries a `PayPal-Request-Id` built from what it acts on, and retries reuse it | `src/lib/paypal.ts`, `src/lib/store-agent.ts` | `paypal.test.ts`, `store-agent.test.ts` |
| A forged or replayed webhook ("refund completed") | Each delivery is checked with PayPal's `verify-webhook-signature`; each event id is applied once | `src/lib/paypal-events.ts` | `paypal-events.test.ts` |
| A store's agent refunds the wrong capture or amount | Its PayPal Agent Toolkit call is checked against what was agreed; the model may only word the note | `src/lib/store-agent.ts` | `store-agent.test.ts` |
| The owner wants to cut Minder off | Removing Minder in their PayPal account sends `VAULT.PAYMENT-TOKEN.DELETED`; Minder then refuses to pay until the owner reconnects | `src/lib/paypal-events.ts`, `src/lib/purchases.ts` | `paypal-events.test.ts` |
| Another website makes the owner's browser call Minder (cross-site request forgery) | API writes that a browser marks as cross-site, and form or plain-text posts, are refused | `src/proxy.ts`, `src/lib/request-guard.ts` | `request-guard.test.ts` |
| Someone floods the public demo (sandbox payments, AI cost) | Rate limits: 5 MCP purchases a minute per caller, 3 tricks a minute, one public reset a minute | `src/lib/rate-limit.ts`, `src/app/api/mcp`, `src/app/api/try` | Manual |
| Visitor-written text is shown to other visitors | Purchases from the trick-it game stay out of the shared activity list, the dashboard and its agents | `src/lib/db.ts` (`readSharedDb`) | Manual |
| Keys leak | Keys live only in environment variables, never reach the browser, and are redacted from logs; the repository holds no keys, data or logs | `src/lib/env.ts`, `src/lib/log.ts`, `.gitignore` | Checked before every commit |
| Maintenance actions are misused (the self-test moves sandbox money; the full reset clears data) | They need `ADMIN_TOKEN` on the live site, compared in constant time | `src/lib/admin.ts` | Manual |

## Known limits

These are deliberate simplifications for a demo, not hidden gaps.

- **No accounts.** On the public demo anyone can act as Maya, and any MCP client acts as her agent. In production the owner would sign in, give each agent its own token (for example through OAuth) with its own limits, and be able to revoke it.
- **One process, one JSON file.** Storage and rate limits live in a single server's disk and memory. On Render's free plan, data returns to the sample story on every restart.
- **The AI review is a second line, not a guarantee.** It catches what the code limits allow through, and its mistakes are bounded by the owner's own limits and by PayPal holds.
- **Sandbox only.** The stores are simulated, disputes are opened with PayPal's sandbox chargeback simulator, and the sandbox keeps an accepted chargeback under review (see the README's notes on what is simulated).

## Reporting a problem

Please do not post security details in a public issue. Open an issue saying you have a security report, and we will arrange a private channel.
