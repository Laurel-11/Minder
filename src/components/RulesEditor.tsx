"use client";

import { useState } from "react";
import { usd } from "@/lib/money";
import type { Policy } from "@/lib/types";

const EXAMPLE =
  "Groceries and food delivery: no more than $60 a week. Ask me before anything over $100. Never buy gift cards.";

export function RulesEditor({ initialText, initialPolicy }: { initialText?: string; initialPolicy?: Policy }) {
  const [text, setText] = useState(initialText ?? EXAMPLE);
  const [policy, setPolicy] = useState<Policy | undefined>(initialPolicy);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      const json = (await res.json()) as { policy?: Policy; error?: string };
      if (!res.ok || !json.policy) throw new Error(json.error ?? "Could not read your rules.");
      setPolicy(json.policy);
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <label className="flex flex-col gap-2">
        <span className="font-medium">Your rules, in your own words</span>
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setSaved(false);
          }}
          rows={4}
          className="rounded-lg border border-line bg-paper p-3 leading-relaxed outline-none focus:border-ink"
        />
      </label>
      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={busy || text.trim().length < 5}
          className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Reading your rules…" : "Save rules"}
        </button>
        {saved && <span className="text-sm text-approve">Saved. Minder enforces these from the next purchase.</span>}
      </div>
      {error && <p className="text-sm text-block">{error}</p>}

      {policy && (
        <section className="rounded-lg border border-line bg-paper p-5">
          <h2 className="font-semibold">How Minder reads them</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {policy.explanation.map((line, n) => (
              <li key={n}>{line}</li>
            ))}
          </ul>
          <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 border-t border-line pt-4 text-sm">
            <dt className="text-muted">Ask me above</dt>
            <dd>{usd(policy.approvalThreshold)}</dd>
            <dt className="text-muted">Never above</dt>
            <dd>{policy.perPurchaseMax === null ? "No hard maximum" : usd(policy.perPurchaseMax)}</dd>
            <dt className="text-muted">Budgets</dt>
            <dd>
              {policy.budgets.length === 0
                ? "None"
                : policy.budgets.map((b, n) => (
                    <span key={n} className="block">
                      {b.label}: {usd(b.limit)} per {b.period}
                      {b.categories.length > 0 && <span className="text-muted"> ({b.categories.join(", ").replaceAll("_", " ")})</span>}
                    </span>
                  ))}
            </dd>
            <dt className="text-muted">Never buy</dt>
            <dd>{policy.blockedCategories.length ? policy.blockedCategories.join(", ").replaceAll("_", " ") : "Nothing"}</dd>
            <dt className="text-muted">Blocked stores</dt>
            <dd>{policy.blockedMerchants.length ? policy.blockedMerchants.join(", ") : "None"}</dd>
          </dl>
          <p className="mt-4 text-xs text-muted">
            These limits are enforced by plain code, not by the AI, so a confused or tricked AI can never spend past them.
          </p>
        </section>
      )}
    </div>
  );
}
