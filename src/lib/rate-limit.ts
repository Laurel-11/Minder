// In-memory limits for the public demo's endpoints that spend sandbox money or AI quota. One server, so memory is enough.
const hits = new Map<string, number[]>();

/** Records one use of `key` and says whether it is over `max` uses in the last `windowMs`. */
export function overLimit(key: string, max: number, windowMs: number, now = Date.now()): { limited: boolean; retryInSeconds: number } {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(key, recent);
    return { limited: true, retryInSeconds: Math.ceil((windowMs - (now - recent[0])) / 1000) };
  }
  recent.push(now);
  hits.set(key, recent);
  return { limited: false, retryInSeconds: 0 };
}

/** The caller's address as Render's proxy reports it. */
export const clientIp = (request: Request) => request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
