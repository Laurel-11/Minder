"use client";

import { useState } from "react";

export function ConnectPayPalButton({ label = "Connect PayPal" }: { label?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/paypal/connect", { method: "POST" });
      const json = (await res.json()) as { approveUrl?: string; error?: string };
      if (!res.ok || !json.approveUrl) throw new Error(json.error ?? "Could not reach PayPal");
      window.location.href = json.approveUrl;
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={connect}
        disabled={busy}
        className="inline-flex w-fit items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-paper transition hover:opacity-90 disabled:opacity-60"
      >
        {busy ? "Opening PayPal…" : label}
      </button>
      {error && <p className="text-sm text-block">{error}</p>}
    </div>
  );
}
