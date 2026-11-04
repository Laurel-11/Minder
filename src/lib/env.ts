// Server-side configuration. Next.js loads .env.local automatically (never commit it).
export const env = {
  paypalClientId: process.env.PAYPAL_CLIENT_ID ?? "",
  paypalClientSecret: process.env.PAYPAL_CLIENT_SECRET ?? "",
  paypalBuyerEmail: process.env.PAYPAL_BUYER_EMAIL ?? "",
  deepseekApiKey: process.env.DEEPSEEK_API_KEY ?? "",
  deepseekModel: process.env.DEEPSEEK_MODEL ?? "deepseek-flash",
  /** DeepSeek thinking for JSON answers: "low", "high" or "off". The dashboard's agents always run without it. */
  deepseekThinking: (process.env.DEEPSEEK_THINKING ?? "low") as "low" | "high" | "off",
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  // Tried in order. Free-tier models are sometimes "busy" (HTTP 503), so we fall back.
  geminiModels: (process.env.GEMINI_MODELS ?? "gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.7-flash,gemini-3.1-flash-lite,gemini-3.8-flash,gemini-flash-latest")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean),
  /** Which AI to try, in order: DeepSeek first when its key is set, then Gemini. Override with AI_PROVIDERS=gemini,deepseek. */
  aiProviders: (process.env.AI_PROVIDERS ?? "deepseek,gemini")
    .split(",")
    .map((p) => p.trim())
    .filter((p): p is "deepseek" | "gemini" => (p === "deepseek" && !!process.env.DEEPSEEK_API_KEY) || (p === "gemini" && !!process.env.GEMINI_API_KEY)),
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
    ["DEEPSEEK_API_KEY (or GEMINI_API_KEY)", env.deepseekApiKey || env.geminiApiKey],
  ];
  return required.filter(([, v]) => !v).map(([k]) => k);
}

/** Values that must never appear in logs or API responses. */
export function secretValues(): string[] {
  return [env.paypalClientSecret, env.deepseekApiKey, env.geminiApiKey, env.adminToken].filter((s) => s.length > 6);
}
