// Money must never move twice: every PayPal write carries an id derived from the action, and a
// "still working on it" answer is retried with that same id.
import { afterEach, describe, expect, it, vi } from "vitest";

type Call = { url: string; headers: Record<string, string> };

async function withPayPal(answers: { status: number; body: unknown }[]) {
  vi.stubEnv("PAYPAL_CLIENT_ID", "test-client");
  vi.stubEnv("PAYPAL_CLIENT_SECRET", "test-secret");
  vi.resetModules();
  const calls: Call[] = [];
  const queue = [...answers];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith("/v1/oauth2/token")) return new Response(JSON.stringify({ access_token: "token", expires_in: 3600 }), { status: 200 });
      calls.push({ url, headers: init.headers as Record<string, string> });
      const next = queue.shift()!;
      return new Response(JSON.stringify(next.body), { status: next.status });
    }),
  );
  return { paypal: await import("../paypal"), calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("PayPal writes", () => {
  it("capture uses an id derived from the authorization, and retries a busy answer with the same id", async () => {
    const busy = { name: "RESOURCE_CONFLICT", details: [{ issue: "PREVIOUS_REQUEST_IN_PROGRESS" }] };
    const { paypal, calls } = await withPayPal([
      { status: 409, body: busy },
      { status: 201, body: { id: "CAPTURE-1", status: "COMPLETED" } },
    ]);
    const r = await paypal.captureAuthorization("AUTH-123");
    expect(r.captureId).toBe("CAPTURE-1");
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.headers["PayPal-Request-Id"])).toEqual(["AUTH-123:capture", "AUTH-123:capture"]);
  });

  it("a refund's id includes the amount, so two different partial refunds stay two refunds", async () => {
    const { paypal, calls } = await withPayPal([{ status: 201, body: { id: "R1", status: "COMPLETED" } }]);
    await paypal.refundCapture("CAP-9", { currency_code: "USD", value: "15.00" }, "Partial refund");
    expect(calls[0].headers["PayPal-Request-Id"]).toBe("CAP-9:refund:15.00");
  });

  it("does not retry a refusal", async () => {
    const { paypal, calls } = await withPayPal([{ status: 422, body: { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "AUTHORIZATION_VOIDED" }] } }]);
    await expect(paypal.captureAuthorization("AUTH-7")).rejects.toThrow(/AUTHORIZATION_VOIDED/);
    expect(calls).toHaveLength(1);
  });
});
