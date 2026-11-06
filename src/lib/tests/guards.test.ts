// The small guards around the public demo: rate limits, the admin token, and secrets kept out of logs.
import { afterEach, describe, expect, it, vi } from "vitest";
import { clientIp, overLimit } from "../rate-limit";

describe("overLimit", () => {
  it("allows up to the limit, then says how long to wait", () => {
    const t = 1_000_000;
    expect(overLimit("t1", 2, 60_000, t).limited).toBe(false);
    expect(overLimit("t1", 2, 60_000, t + 1000).limited).toBe(false);
    expect(overLimit("t1", 2, 60_000, t + 2000)).toEqual({ limited: true, retryInSeconds: 58 });
  });
  it("forgets uses older than the window", () => {
    const t = 2_000_000;
    overLimit("t2", 1, 60_000, t);
    expect(overLimit("t2", 1, 60_000, t + 30_000).limited).toBe(true);
    expect(overLimit("t2", 1, 60_000, t + 61_000).limited).toBe(false);
  });
  it("counts each key on its own", () => {
    const t = 3_000_000;
    overLimit("t3:a", 1, 60_000, t);
    expect(overLimit("t3:b", 1, 60_000, t).limited).toBe(false);
  });
  it("reads the caller's address from the first forwarded hop", () => {
    expect(clientIp(new Request("http://x", { headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" } }))).toBe("203.0.113.7");
    expect(clientIp(new Request("http://x"))).toBe("local");
  });
});

describe("secrets and the admin token", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });
  it("redact replaces every configured secret and PayPal access tokens", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "sk-test-secret-123456");
    vi.resetModules();
    const { redact } = await import("../log");
    expect(redact("key=sk-test-secret-123456 ok")).toBe("key=*** ok");
    expect(redact("Bearer A21AAabcdefghijklmnopqrstuvwxyz0123")).toBe("Bearer A21AA***");
  });
  it("maintenance endpoints are open locally", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { adminAllowed } = await import("../admin");
    expect(adminAllowed(new Request("http://x"))).toBe(true);
  });
  it("once deployed they need the exact admin token", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ADMIN_TOKEN", "a-long-admin-token-for-tests");
    vi.resetModules();
    const { adminAllowed } = await import("../admin");
    const withToken = (t?: string) => new Request("http://x", { headers: t ? { "x-admin-token": t } : {} });
    expect(adminAllowed(withToken("a-long-admin-token-for-tests"))).toBe(true);
    expect(adminAllowed(withToken("a-long-admin-token-for-test!"))).toBe(false);
    expect(adminAllowed(withToken("short"))).toBe(false);
    expect(adminAllowed(withToken())).toBe(false);
  });
  it("a missing or too-short admin token on the server locks everything", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ADMIN_TOKEN", "short");
    vi.resetModules();
    const { adminAllowed } = await import("../admin");
    expect(adminAllowed(new Request("http://x", { headers: { "x-admin-token": "short" } }))).toBe(false);
  });
});
