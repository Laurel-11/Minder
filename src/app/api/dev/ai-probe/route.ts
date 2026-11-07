// Development-only probe: how DeepSeek answers right now, with and without thinking. Disabled in production.
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") return new Response("Not found", { status: 404 });
  const { thinking = "low", tries = 3 } = (await request.json().catch(() => ({}))) as { thinking?: string; tries?: number };
  const results: { status: number; ms: number; ok: boolean; note?: string }[] = [];
  for (let i = 0; i < Math.min(tries, 6); i++) {
    const started = Date.now();
    try {
      const res = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.deepseekApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: env.deepseekModel,
          messages: [
            { role: "system", content: 'Answer with JSON only: {"ok": true}' },
            { role: "user", content: "Health check." },
          ],
          response_format: { type: "json_object" },
          max_tokens: 2000,
          ...(thinking === "off" ? { thinking: { type: "disabled" } } : { thinking: { type: "enabled" }, reasoning_effort: thinking }),
        }),
        signal: AbortSignal.timeout(40_000),
      });
      const text = await res.text();
      results.push({ status: res.status, ms: Date.now() - started, ok: res.ok && text.includes("choices"), note: res.ok ? undefined : text.slice(0, 120) });
    } catch (e) {
      results.push({ status: 0, ms: Date.now() - started, ok: false, note: (e as Error).message.slice(0, 120) });
    }
  }
  return Response.json({ model: env.deepseekModel, thinking, results });
}
