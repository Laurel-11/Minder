// Server-side configuration. Next.js loads .env.local automatically (never commit it).
export const env = {
  paypalClientId: process.env.PAYPAL_CLIENT_ID ?? "",
  paypalClientSecret: process.env.PAYPAL_CLIENT_SECRET ?? "",
  paypalBuyerEmail: process.env.PAYPAL_BUYER_EMAIL ?? "",
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  // Tried in order. Free-tier models are sometimes "busy" (HTTP 503), so we fall back.
  geminiModels: (process.env.GEMINI_MODELS ?? "gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.7-flash,gemini-3.1-flash-lite,gemini-3.8-flash,gemini-flash-latest")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean),
  // Where the site lives. Render sets RENDER_EXTERNAL_URL automatically.
  appUrl: (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || "http://localhost:3000").replace(/\/$/, ""),
  /** Maya's saved PayPal (a vault payment token), so a fresh cloud instance can pay without reconnecting. */
  paypalVaultId: process.env.PAYPAL_VAULT_ID ?? "",
  paypalVaultCustomerId: process.env.PAYPAL_VAULT_CUSTOMER_ID ?? "",
  /** Unlocks the demo reset and self-test when deployed. Not needed locally. */
  adminToken: process.env.ADMIN_TOKEN ?? "",
};

export function missingEnv(): string[] {
  const required: [string, string][] = [
    ["PAYPAL_CLIENT_ID", env.paypalClientId],
    ["PAYPAL_CLIENT_SECRET", env.paypalClientSecret],
    ["GEMINI_API_KEY", env.geminiApiKey],
  ];
  return required.filter(([, v]) => !v).map(([k]) => k);
}

/** Values that must never appear in logs or API responses. */
export function secretValues(): string[] {
  return [env.paypalClientSecret, env.geminiApiKey, env.adminToken].filter((s) => s.length > 6);
}
