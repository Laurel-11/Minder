// Gemini client: JSON-only answers, hard timeouts, retries and a model fallback chain.
import { env } from "./env";
import { fetchWithTimeout, sleep } from "./http";
import { log } from "./log";

const GEMINI = "https://generativelanguage.googleapis.com/v1beta";

export class AiUnavailableError extends Error {}

/** Gemini response schema (OpenAPI subset, upper-case types). */
export type Schema = {
  type: "OBJECT" | "ARRAY" | "STRING" | "NUMBER" | "INTEGER" | "BOOLEAN";
  description?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  enum?: string[];
  nullable?: boolean;
};

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  error?: { status?: string; message?: string };
};

export async function generateJson<T>(input: {
  system: string;
  prompt: string;
  schema: Schema;
  temperature?: number;
  timeoutMs?: number;
}): Promise<{ data: T; model: string }> {
  const errors: string[] = [];
  for (const model of env.geminiModels) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const started = Date.now();
      try {
        const res = await fetchWithTimeout(
          `${GEMINI}/models/${model}:generateContent`,
          {
            method: "POST",
            headers: { "x-goog-api-key": env.geminiApiKey, "Content-Type": "application/json" },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: input.system }] },
              contents: [{ role: "user", parts: [{ text: input.prompt }] }],
              generationConfig: {
                temperature: input.temperature ?? 0.2,
                responseMimeType: "application/json",
                responseSchema: input.schema,
              },
            }),
          },
          input.timeoutMs ?? 30_000,
        );
        const json = (await res.json()) as GeminiResponse;
        if (!res.ok) {
          errors.push(`${model}: HTTP ${res.status} ${json.error?.status ?? ""}`.trim());
          log("ai.error", { model, status: res.status, apiStatus: json.error?.status });
          if (res.status === 503 || res.status === 429) {
            await sleep(1500 * attempt);
            continue;
          }
          break; // other errors: try the next model
        }
        const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
        const data = JSON.parse(text) as T;
        log("ai.ok", { model, ms: Date.now() - started });
        return { data, model };
      } catch (e) {
        errors.push(`${model}: ${(e as Error).message}`);
        log("ai.error", { model, error: (e as Error).message });
        break;
      }
    }
  }
  throw new AiUnavailableError(`AI is unavailable right now (${errors.join("; ")})`);
}
