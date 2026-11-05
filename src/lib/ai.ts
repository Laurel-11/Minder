// AI client: JSON-only answers, hard timeouts, retries and fallbacks. DeepSeek is tried first when its
// key is set, then Gemini (see env.aiProviders), so one provider being down or out of quota is survivable.
// If every provider fails, calls that name a replay key get the answer the AI gave for that exact
// request when it was recorded (src/lib/ai-replay.json), clearly marked, so the demo keeps working.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { env } from "./env";
import { fetchWithTimeout, sleep } from "./http";
import { log } from "./log";

const GEMINI = "https://generativelanguage.googleapis.com/v1beta";
export const DEEPSEEK = "https://api.deepseek.com";

export class AiUnavailableError extends Error {}

/** Response schema in Gemini's OpenAPI subset (upper-case types). DeepSeek gets it as JSON Schema in the prompt. */
export type Schema = {
  type: "OBJECT" | "ARRAY" | "STRING" | "NUMBER" | "INTEGER" | "BOOLEAN";
  description?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  enum?: string[];
  nullable?: boolean;
};

type JsonInput = {
  system: string;
  prompt: string;
  schema: Schema;
  temperature?: number;
  timeoutMs?: number;
  /** Names this request for the replay file. Leave out what changes from run to run (dates, history, URLs). */
  replay?: { key: string; label: string };
};

export async function generateJson<T>(input: JsonInput): Promise<{ data: T; model: string; recorded?: boolean }> {
  const errors: string[] = [];
  for (const provider of env.aiProviders) {
    const result = provider === "deepseek" ? await deepseekJson<T>(input, errors) : await geminiJson<T>(input, errors);
    if (result) {
      if (input.replay) recordReplay(input.replay, result.data, result.model);
      return result;
    }
  }
  const hit = input.replay ? readReplay()[replayId(input.replay.key)] : undefined;
  if (hit && !shapeProblem(hit.data, input.schema)) {
    log("ai.replay", { label: hit.label, errors: errors.length });
    return { data: hit.data as T, model: `${hit.model}, recorded ${hit.recordedAt.slice(0, 10)}`, recorded: true };
  }
  throw new AiUnavailableError(`AI is unavailable right now (${errors.join("; ") || "no AI key is set"})`);
}

// ---------- Replay: the AI's recorded answers for the demo's own requests ----------

export const REPLAY_FILE = process.env.AI_REPLAY_FILE ?? path.join(/* turbopackIgnore: true */ process.cwd(), "src", "lib", "ai-replay.json");
type ReplayEntry = { label: string; model: string; recordedAt: string; data: unknown };

export const replayId = (key: string) => crypto.createHash("sha256").update(key.trim().toLowerCase()).digest("hex").slice(0, 16);

export function readReplay(): Record<string, ReplayEntry> {
  try {
    return JSON.parse(fs.readFileSync(process.env.AI_REPLAY_FILE ?? REPLAY_FILE, "utf8")) as Record<string, ReplayEntry>;
  } catch {
    return {};
  }
}

/** Development only: keep the latest real answer for each named request, to ship with the code. */
function recordReplay(replay: { key: string; label: string }, data: unknown, model: string) {
  if (process.env.NODE_ENV !== "development") return;
  try {
    const all = readReplay();
    all[replayId(replay.key)] = { label: replay.label, model, recordedAt: new Date().toISOString(), data };
    const sorted = Object.fromEntries(Object.entries(all).sort(([, a], [, b]) => a.label.localeCompare(b.label)));
    fs.writeFileSync(REPLAY_FILE, JSON.stringify(sorted, null, 1) + "\n");
  } catch (e) {
    log("ai.replay_record_failed", { error: (e as Error).message });
  }
}

// ---------- DeepSeek (OpenAI-compatible chat completions) ----------

/** Gemini's schema subset as standard JSON Schema. */
export function toJsonSchema(s: Schema): Record<string, unknown> {
  const type = s.type.toLowerCase();
  const out: Record<string, unknown> = { type: s.nullable ? [type, "null"] : type };
  if (s.description) out.description = s.description;
  if (s.enum) out.enum = s.enum;
  if (s.properties) out.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, toJsonSchema(v)]));
  if (s.required) out.required = s.required;
  if (s.items) out.items = toJsonSchema(s.items);
  return out;
}

/** The first way the value breaks the schema, or null. JSON mode guarantees JSON, not the shape. */
export function shapeProblem(value: unknown, s: Schema, path = "answer"): string | null {
  if (value === null || value === undefined) return s.nullable ? null : `${path} is missing`;
  switch (s.type) {
    case "OBJECT": {
      if (typeof value !== "object" || Array.isArray(value)) return `${path} is not an object`;
      const obj = value as Record<string, unknown>;
      for (const k of s.required ?? []) if (!(k in obj)) return `${path}.${k} is missing`;
      for (const [k, sub] of Object.entries(s.properties ?? {})) {
        if (k in obj) {
          const p = shapeProblem(obj[k], sub, `${path}.${k}`);
          if (p) return p;
        }
      }
      return null;
    }
    case "ARRAY": {
      if (!Array.isArray(value)) return `${path} is not a list`;
      for (let i = 0; i < value.length; i++) {
        const p = s.items ? shapeProblem(value[i], s.items, `${path}[${i}]`) : null;
        if (p) return p;
      }
      return null;
    }
    case "STRING":
      if (typeof value !== "string") return `${path} is not text`;
      return s.enum && !s.enum.includes(value) ? `${path} is "${value}", not one of ${s.enum.join(", ")}` : null;
    case "NUMBER":
    case "INTEGER":
      return typeof value === "number" && Number.isFinite(value) ? null : `${path} is not a number`;
    case "BOOLEAN":
      return typeof value === "boolean" ? null : `${path} is not true or false`;
  }
}

type ChatReply = { choices?: { message?: { content?: string | null }; finish_reason?: string }[]; error?: { message?: string } };

async function deepseekJson<T>(input: JsonInput, errors: string[]): Promise<{ data: T; model: string } | null> {
  if (!env.deepseekApiKey) return null;
  const model = env.deepseekModel;
  const system = `${input.system}\n\nAnswer with a single JSON object and nothing else. It must match this JSON Schema exactly (every required field, enum values spelled exactly):\n${JSON.stringify(toJsonSchema(input.schema))}`;
  const messages: { role: string; content: string }[] = [
    { role: "system", content: system },
    { role: "user", content: input.prompt },
  ];
  for (let attempt = 1; attempt <= 3; attempt++) {
    const started = Date.now();
    try {
      const res = await fetchWithTimeout(
        `${DEEPSEEK}/chat/completions`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${env.deepseekApiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages,
            response_format: { type: "json_object" },
            temperature: input.temperature ?? 0.2,
            max_tokens: 4000,
            ...(env.deepseekThinking === "off" ? { thinking: { type: "disabled" } } : { thinking: { type: "enabled" }, reasoning_effort: env.deepseekThinking }),
          }),
        },
        input.timeoutMs ?? 60_000,
      );
      const json = (await res.json().catch(() => ({}))) as ChatReply;
      if (!res.ok) {
        errors.push(`${model}: HTTP ${res.status}`);
        log("ai.error", { model, status: res.status, message: json.error?.message?.slice(0, 200) });
        if (res.status === 429 || res.status >= 500) {
          await sleep(1500 * attempt);
          continue;
        }
        return null; // 401/402/400: this provider will not work now; try the next one
      }
      const text = json.choices?.[0]?.message?.content ?? "";
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        errors.push(`${model}: answer was not JSON`);
        log("ai.error", { model, error: "not json", finish: json.choices?.[0]?.finish_reason });
        continue;
      }
      const problem = shapeProblem(data, input.schema);
      if (problem) {
        errors.push(`${model}: ${problem}`);
        log("ai.error", { model, error: problem });
        // Show the model its own mistake once; it nearly always fixes it.
        messages.splice(2, messages.length, { role: "assistant", content: text }, { role: "user", content: `That JSON does not match the schema: ${problem}. Answer again with the corrected JSON object only.` });
        continue;
      }
      log("ai.ok", { model, ms: Date.now() - started });
      return { data: data as T, model };
    } catch (e) {
      errors.push(`${model}: ${(e as Error).message}`);
      log("ai.error", { model, error: (e as Error).message });
    }
  }
  return null;
}

// ---------- Gemini ----------

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  error?: { status?: string; message?: string };
};

async function geminiJson<T>(input: JsonInput, errors: string[]): Promise<{ data: T; model: string } | null> {
  if (!env.geminiApiKey) return null;
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
          if (res.status === 403 || res.status === 401) return null; // the key itself is refused: no other Gemini model will work
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
  return null;
}
