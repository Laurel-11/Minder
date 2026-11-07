import type { Metadata } from "next";
import Link from "next/link";
import { ReceiptTamper } from "@/components/ReceiptTamper";
import { readDb } from "@/lib/db";
import { shortDateTime } from "@/lib/format";
import { checkBook, GENESIS, KIND_LABEL, publicKey } from "@/lib/receipts";
import type { Receipt } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Minder's receipt book",
  description: "Every decision Minder makes about your money, signed and chained so nobody can quietly change it.",
};

const REPO = "https://github.com/Laurel-11/Minder";
const SHOWN = 60;

function tone(r: Receipt): string {
  const d = (r.facts as { decision?: string }).decision;
  if (r.kind === "decision") return d === "block" ? "text-block" : d === "hold" ? "text-hold" : "text-approve";
  if (r.kind === "refund" || (r.kind === "owner" && d === "approve")) return "text-approve";
  if (r.kind === "dispute" || r.kind === "store_blocked") return "text-block";
  return "text-ink";
}

const short = (hash: string) => (hash === GENESIS ? "the start of the book" : `${hash.slice(0, 10)}…`);

export default async function ReceiptsPage() {
  const db = await readDb();
  const book = db.receipts ?? [];
  const check = checkBook(book);
  const key = publicKey();
  const trick = new Set(db.purchases.filter((p) => p.source === "trick").map((p) => p.id));
  const newestFirst = [...book].reverse();
  // The panel starts on a blocked decision, where changing the verdict or the total is the obvious thing to try.
  const rank = (r: Receipt) => {
    const f = r.facts as { decision?: string; ai?: { manipulationSuspected?: boolean } | null };
    if (r.kind !== "decision") return 3;
    return f.decision === "block" ? (f.ai?.manipulationSuspected ? 0 : 1) : 2;
  };
  const forPanel = [...newestFirst].sort((a, b) => rank(a) - rank(b)).slice(0, 30);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-3xl font-medium tracking-tight">Receipt book</h1>
        <p className="mt-2 max-w-prose leading-relaxed text-muted">
          Every decision Minder makes about Maya&apos;s money, and every step PayPal confirms, is written down here as a receipt. Each receipt carries the
          fingerprint of the one before it and Minder&apos;s signature. Nobody can change, remove or reorder a receipt without it showing, and you can check that
          yourself without trusting Minder.
        </p>
      </div>

      <section className={`rounded-xl px-5 py-4 ${check.ok ? "bg-approve-soft" : "bg-block-soft"}`}>
        {book.length === 0 ? (
          <p className="font-semibold">The book is empty. The first purchase will start it.</p>
        ) : check.ok ? (
          <>
            <p className="text-lg font-semibold text-approve">All {book.length} receipts check out.</p>
            <p className="mt-1 text-sm">Checked when this page loaded: every fingerprint, every signature, and every link back to receipt #1.</p>
          </>
        ) : (
          <>
            <p className="text-lg font-semibold text-block">The book does not check out.</p>
            <ul className="mt-1 text-sm">
              {check.problems.slice(0, 5).map((p) => (
                <li key={`${p.n}-${p.problem}`}>{p.problem}</li>
              ))}
            </ul>
          </>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <span>
            Minder&apos;s public key <code className="rounded bg-white/70 px-1.5 py-0.5 font-mono text-[12px]">{key.id}</code>
          </span>
          {book.length > 0 && (
            <a href="/api/receipts/download" className="font-medium underline underline-offset-2">
              Download the book
            </a>
          )}
          <a href="#check-yourself" className="font-medium underline underline-offset-2">
            Check it yourself
          </a>
        </div>
      </section>

      {forPanel.length > 0 && <ReceiptTamper receipts={forPanel} />}

      {book.length > 0 && (
        <section aria-labelledby="book" className="flex flex-col gap-3">
          <h2 id="book" className="text-xl font-semibold tracking-tight">
            The book, newest first
          </h2>
          <ol className="flex flex-col">
            {newestFirst.slice(0, SHOWN).map((r, i) => (
              <li key={r.n} className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-3">
                <div className="flex flex-col items-center">
                  <span className="mt-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-paper text-[13px] font-semibold tabular-nums">
                    {r.n}
                  </span>
                  {i < Math.min(SHOWN, newestFirst.length) - 1 && <span aria-hidden className="w-0.5 flex-1 bg-line" />}
                </div>
                <article className="mb-3 rounded-lg border border-line bg-paper px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="font-semibold">{KIND_LABEL[r.kind]}</span>
                    <span className="tabular-nums text-muted">{shortDateTime(r.at)}</span>
                  </div>
                  <p className={`mt-1 leading-relaxed ${tone(r)}`}>{r.says}</p>
                  {r.purchaseId &&
                    (trick.has(r.purchaseId) ? (
                      <p className="mt-1 text-muted">From the trick-it page, where visitors write the store&apos;s note.</p>
                    ) : (
                      <Link href={`/purchases/${r.purchaseId}`} className="mt-1 inline-block underline underline-offset-2">
                        See the purchase
                      </Link>
                    ))}
                  <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11.5px] text-muted">
                    <span>fingerprint {short(r.hash)}</span>
                    <span>points at {short(r.prev)}</span>
                  </p>
                </article>
              </li>
            ))}
          </ol>
          {book.length > SHOWN && (
            <p className="text-sm text-muted">
              Showing the newest {SHOWN} of {book.length}.{" "}
              <a href="/api/receipts/download" className="underline underline-offset-2">
                Download the book
              </a>{" "}
              for all of them.
            </p>
          )}
        </section>
      )}

      <section id="check-yourself" aria-labelledby="yourself" className="flex scroll-mt-6 flex-col gap-3">
        <h2 id="yourself" className="text-xl font-semibold tracking-tight">
          Check it yourself
        </h2>
        <ol className="list-decimal space-y-2 pl-5 text-[15px] leading-relaxed">
          <li>
            Download the book, or the evidence for one purchase from its page. Both are plain JSON with Minder&apos;s public key in them.
          </li>
          <li>
            Run <code className="rounded bg-paper px-1.5 py-0.5 font-mono text-[13px]">node scripts/verify-receipts.mjs minder-receipt-book.json --key {key.id}</code>{" "}
            from{" "}
            <a href={REPO} className="underline underline-offset-2">
              Minder&apos;s code
            </a>
            . It needs nothing but Node: it recomputes every fingerprint, checks every signature and follows the chain back to receipt #1.
          </li>
          <li>
            Check the other side: every order Minder places carries its decision receipt&apos;s fingerprint on PayPal&apos;s own record, as the order&apos;s{" "}
            <code className="rounded bg-paper px-1.5 py-0.5 font-mono text-[13px]">custom_id</code>. Each purchase page has a button that asks PayPal for it.
          </li>
        </ol>
        <p className="max-w-prose text-sm text-muted">
          A receipt holds facts: what Maya asked for, what was bought, the total, each rule&apos;s result and what PayPal did. What a store&apos;s page said stays
          with the purchase, and the receipt holds its fingerprint, so that evidence can be checked too. A claim or a PayPal dispute cites the receipts for its
          order. The key is derived from a server secret and never leaves the server.
        </p>
      </section>
    </div>
  );
}
