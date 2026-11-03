"use client";

import { useEffect, useState } from "react";

type Check = { ok: boolean; detail: string };
type Health = { env: Check; paypal: Check; ai: Check; vault: Check };

const labels: Record<keyof Health, string> = {
  env: "Configuration",
  paypal: "PayPal sandbox",
  ai: "AI model (Gemini)",
  vault: "Maya's saved PayPal",
};

export default function StatusPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <h1 className="font-display text-3xl font-semibold tracking-tight">System status</h1>
      {error && <p className="text-block">{error}</p>}
      {!health && !error && <p className="text-muted">Checking PayPal and the AI model… (up to 30 seconds)</p>}
      {health && (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-card">
          {(Object.keys(labels) as (keyof Health)[]).map((key) => (
            <li key={key} className="flex items-start gap-3 px-5 py-4">
              <span
                className={`mt-0.5 rounded-full px-2 py-0.5 text-xs font-medium ${health[key].ok ? "bg-approve-soft text-approve" : "bg-block-soft text-block"}`}
              >
                {health[key].ok ? "OK" : "Problem"}
              </span>
              <div>
                <p className="font-medium">{labels[key]}</p>
                <p className="text-sm text-muted">{health[key].detail}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
