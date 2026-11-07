# The receipt book

Every decision Minder makes about the owner's money, and every money move that PayPal confirms, is written down as a receipt. Each receipt carries the fingerprint of the receipt before it and Minder's signature. A changed, removed or reordered receipt shows up, and anyone can check that without trusting Minder. This includes Minder's own operators.

The live book is at [/receipts](https://minder-2hey.onrender.com/receipts). The code is [`src/lib/receipts.ts`](../src/lib/receipts.ts).

## What gets a receipt

| Receipt | Written when | What it records |
|---|---|---|
| Rules | The owner saves rules | The rules text and the policy code enforces |
| Minder decided | Every purchase request, before PayPal sees anything | The owner's words, the store, items, total, each rule's result, the AI review's verdict and model, and fingerprints of the free text behind the decision |
| PayPal | The order is created | Order id, intent (capture or authorize), capture or authorization id, and the fingerprint written on the order |
| You decided | The owner signs or declines a held purchase | Capture id, or the voided authorization |
| Delivery | After payment | The store's ship-by promise, carrier and tracking number, and whether the tracking is on the PayPal order |
| Claim | Minder opens a case | The problem, what Minder asked for, the store's offer, Minder's advice, and the receipts it cites |
| Refund / PayPal dispute | The owner accepts an offer or escalates | Refund id and amount, or dispute id, reason code and the receipts given as evidence |
| PayPal confirmed | A webhook arrives and PayPal confirms its signature | Event id, type and resource |
| Store blocked | The owner blocks a store after a case | The store and why |

Receipts hold facts, not free text from stores. The words a store page aimed at the agent, the agent's justification and the AI's findings stay with the purchase. The decision receipt holds their SHA-256 fingerprints, so the evidence can be checked. The book does not repeat whatever a page or a visitor wrote.

## How a receipt is sealed

```
fingerprint = SHA-256( canonical JSON of { format: "minder-receipt-v1", n, at, kind, purchaseId, caseId, says, facts, prev } )
signature   = Ed25519( fingerprint bytes )
prev        = the fingerprint of receipt n-1 (64 zeros for receipt #1)
```

Canonical JSON means every object's keys are sorted and there are no spaces. Missing values are left out.

- **Change a fact**, even one cent, and the fingerprint no longer matches.
- **Write a new fingerprint** to hide it, and the signature no longer fits.
- **Remove or reorder a receipt**, and the next one no longer points at the one before.
- **Forge a signature** and you need Minder's private key. The key is derived with HKDF-SHA256 from a server secret (`MINDER_RECEIPT_SECRET`, or the PayPal app secret), so it is never stored and never leaves the server. The public key and its id are on the Receipts page and in every download.

## Tied to PayPal's own records

The decision receipt is written before the PayPal order is created. Its fingerprint becomes the order's `custom_id`, so PayPal's own record of the payment points back to the signed receipt, and the next receipt records the PayPal order id. Each purchase page has a **Check with PayPal** button that reads the order back from PayPal and compares the two.

When Minder escalates a case, the note it hands PayPal's dispute starts with the latest receipt for that order, for example `[Minder receipt #23 2ffc37bb75…]`. The claim letter to the store names the receipts too.

## Check it yourself

1. Download the book from the Receipts page, or the evidence pack from a purchase page.
2. Run the checker. It needs nothing but Node 18 or newer:

```bash
node scripts/verify-receipts.mjs minder-receipt-book.json --key <key id from the Receipts page>
```

It recomputes every fingerprint, checks every signature and follows the chain back to receipt #1. For an evidence pack, it also recomputes the fingerprints of the evidence: the store's page text, the agent's reason, the AI's findings and the reasons shown to the owner. It then checks them against the decision receipt and confirms that the PayPal order was given that receipt's fingerprint.

The Receipts page also has **Change one and see**. Edit a copy of any receipt and the server checks your copy exactly as it checks the book.

## Limits

- One server keeps the book. Signatures prove that Minder wrote a receipt and that nobody changed it since. They cannot prove that Minder wrote down everything. The fingerprint on each PayPal order is an outside anchor for the receipts that matter most.
- The demo's sample story is shipped with its receipts. A fresh copy of the site signs them again with its own key. The fingerprints stay exactly as recorded, so the chain and the fingerprints on PayPal's orders still match.
- The demo runs on Render without a persistent disk. Each deploy or restart starts the book again from the sample story, and so does the demo's **Reset the demo** button. In a real deployment the book would live in a database and never be reset.
