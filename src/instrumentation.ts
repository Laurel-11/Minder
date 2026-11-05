// Runs once when the server starts. On the public site, make sure PayPal knows where to send webhooks.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { ensureWebhook } = await import("./lib/paypal-events");
  const { log } = await import("./lib/log");
  ensureWebhook().catch((e: Error) => log("paypal.webhook_setup_failed", { error: e.message }));
}
