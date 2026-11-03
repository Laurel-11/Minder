"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CaseProblem } from "@/lib/types";

/** After a bad order, offer to block the store so the agent can never pay it again. */
export function BlockStore({ caseId, storeName, problem, blocked }: { caseId: string; storeName: string; problem: CaseProblem; blocked: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function block() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/cases/${caseId}/block-store`, { method: "POST" });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Could not update your rules.");
      setDone(true);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (blocked || done) {
    return (
      <div className="border-t border-line pt-4 text-sm">
        <p>
          <span className="font-medium">{storeName} is blocked.</span> Chaperone will refuse every payment to it, even if a store page talks your agent
          into trying.
        </p>
        <Link href="/rules" className="mt-1 inline-block underline underline-offset-2">
          See your rules
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-4 text-sm">
      <p>
        <span className="font-medium">Stop paying {storeName}? </span>
        {problem === "not_delivered" ? `${storeName} took your money and never shipped.` : `Your order from ${storeName} arrived damaged.`} Block it, and
        Chaperone will refuse every future payment to it.
      </p>
      <div>
        <button onClick={block} disabled={busy} className="rounded-lg border-2 border-ink px-4 py-2 text-sm font-medium disabled:opacity-50">
          {busy ? "Blocking…" : `Block ${storeName}`}
        </button>
      </div>
      {error && <p className="break-words text-block">{error}</p>}
    </div>
  );
}
