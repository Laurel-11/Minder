// Server half of the AG Studio <-> Gemini adapter. Studio's agents run in the browser and send each
// turn here; we translate it to Gemini function calling, so the Gemini API key never leaves the server.
import type { AgLlmRequest, AgLlmResponse } from "ag-studio";
import crypto from "node:crypto";
import { env } from "@/lib/env";
import { fetchWithTimeout, sleep } from "@/lib/http";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const GEMINI = "https://generativelanguage.googleapis.com/v1beta";
// Gemini 3 models return a "thought signature" with each function call and require it back on the next turn.
const signatures = new Map<string, string>();
const SKIP_SIGNATURE = "skip_thought_signature_validator";

type Part = Record<string, unknown>;
type Content = { role: "user" | "model"; parts: Part[] };
const rid = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((c: { type?: string; text?: string; refusal?: string }) => c.text ?? c.refusal ?? "")
    .filter(Boolean)
    .join("\n");
}

type J = Record<string, unknown>;

/**
 * Gemini rejects JSON Schemas whose $ref recursion has required fields (Studio's layout tools have them).
 * Inline the $refs up to a small depth and replace deeper recursion with a loose object.
 */
function sanitizeSchema(schema: unknown): unknown {
  const root = (schema ?? {}) as J;
  const defs = { ...((root.definitions as J) ?? {}), ...((root.$defs as J) ?? {}) };
  for (const maxDepth of [3, 2, 1]) {
    const walk = (node: unknown, depth: number): unknown => {
      if (Array.isArray(node)) return node.map((n) => walk(n, depth));
      if (!node || typeof node !== "object") return node;
      const obj = node as J;
      if (typeof obj.$ref === "string") {
        const target = defs[obj.$ref.split("/").pop() ?? ""];
        if (!target || depth >= maxDepth) return { type: "object", description: "Nested value with the same shape as its parent." };
        return walk(target, depth + 1);
      }
      const out: J = {};
      for (const [k, v] of Object.entries(obj)) {
        if (k === "$defs" || k === "definitions" || k === "$schema") continue;
        out[k] = walk(v, depth);
      }
      return out;
    };
    const result = walk(root, 0);
    if (JSON.stringify(result).length < 60_000) return result;
  }
  return { type: "object" };
}

function toGemini(request: AgLlmRequest) {
  const contents: Content[] = [];
  const system: string[] = request.instructions ? [request.instructions] : [];
  const callNames = new Map<string, string>();
  const push = (role: Content["role"], part: Part) => {
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts.push(part);
    else contents.push({ role, parts: [part] });
  };

  for (const item of request.input) {
    if (item.type === "message") {
      const text = textOf(item.content);
      if (!text) continue;
      if (item.role === "system") system.push(text);
      else push(item.role === "assistant" ? "model" : "user", { text });
    } else if (item.type === "function_call") {
      callNames.set(item.callId, item.name);
      let args: unknown = {};
      try {
        args = item.arguments ? JSON.parse(item.arguments) : {};
      } catch {
        args = {};
      }
      push("model", { functionCall: { id: item.callId, name: item.name, args }, thoughtSignature: signatures.get(item.callId) ?? SKIP_SIGNATURE });
    } else if (item.type === "function_call_output") {
      let response: Record<string, unknown>;
      try {
        const parsed = JSON.parse(item.output);
        response = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : { result: parsed };
      } catch {
        response = { result: item.output };
      }
      push("user", { functionResponse: { id: item.callId, name: callNames.get(item.callId) ?? "tool", response } });
    }
  }
  if (contents.length === 0 || contents[0].role !== "user") contents.unshift({ role: "user", parts: [{ text: "Continue." }] });

  const declarations = (request.tools ?? [])
    .filter((t) => t.kind !== "provided")
    .map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: sanitizeSchema(t.parameters ?? { type: "object", properties: {} }) }));

  const body: Record<string, unknown> = {
    contents,
    // Low thinking keeps each Studio turn fast; the agents make many small turns.
    generationConfig: { temperature: 0.2, thinkingConfig: { thinkingLevel: "low" } } as Record<string, unknown>,
  };
  if (system.length) body.systemInstruction = { parts: [{ text: system.join("\n\n") }] };
  if (declarations.length) {
    body.tools = [{ functionDeclarations: declarations }];
    const choice = request.toolChoice ?? "auto";
    body.toolConfig = {
      functionCallingConfig:
        typeof choice === "object"
          ? { mode: "ANY", allowedFunctionNames: [choice.name] }
          : { mode: choice === "none" ? "NONE" : choice === "required" ? "ANY" : "AUTO" },
    };
  }
  if (request.responseFormat?.type === "json") {
    const gen = body.generationConfig as Record<string, unknown>;
    gen.responseMimeType = "application/json";
    gen.responseJsonSchema = sanitizeSchema(request.responseFormat.schema);
  }
  return body;
}

type GeminiPart = { text?: string; thought?: boolean; thoughtSignature?: string; functionCall?: { id?: string; name: string; args?: unknown } };
type GeminiReply = {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { status?: string; message?: string };
};

function fromGemini(reply: GeminiReply, model: string): AgLlmResponse {
  const cand = reply.candidates?.[0];
  const parts = cand?.content?.parts ?? [];
  const output: AgLlmResponse["output"] = [];
  const text = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join("");
  if (text) {
    output.push({ id: rid("msg"), kind: "output", type: "message", role: "assistant", status: "completed", content: [{ type: "text", text, annotations: [] }] });
  }
  for (const p of parts) {
    if (!p.functionCall) continue;
    const callId = p.functionCall.id ?? rid("call");
    if (p.thoughtSignature) signatures.set(callId, p.thoughtSignature);
    output.push({ id: rid("fc"), kind: "output", type: "function_call", callId, name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args ?? {}), status: "completed" });
  }
  if (signatures.size > 2000) signatures.delete(signatures.keys().next().value as string);
  return {
    id: rid("resp"),
    createdAt: Date.now(),
    status: cand?.finishReason === "MAX_TOKENS" ? "incomplete" : "completed",
    incompleteDetails: cand?.finishReason === "MAX_TOKENS" ? { reason: "max_output_tokens" } : undefined,
    output,
    model,
  };
}

const failed = (message: string): AgLlmResponse => ({
  id: rid("resp"),
  createdAt: Date.now(),
  status: "failed",
  output: [],
  error: { code: "ai_unavailable", message },
});

// Models that just answered 429 (free quota used up) are skipped for a while.
const coolDown = new Map<string, number>();

export async function POST(req: Request) {
  const request = (await req.json()) as AgLlmRequest;
  const geminiBody = toGemini(request);
  const errors: string[] = [];
  for (let round = 1; round <= 2; round++) {
    let retryable = false;
    for (const model of env.geminiModels) {
      if ((coolDown.get(model) ?? 0) > Date.now() && round === 1) continue;
      const started = Date.now();
      try {
        let res = await callGemini(model, geminiBody);
        let reply = (await res.json()) as GeminiReply;
        if (res.status === 400 && /thinking/i.test(reply.error?.message ?? "")) {
          // Some models do not accept thinkingLevel: retry once without it.
          const gen = { ...(geminiBody.generationConfig as Record<string, unknown>) };
          delete gen.thinkingConfig;
          res = await callGemini(model, { ...geminiBody, generationConfig: gen });
          reply = (await res.json()) as GeminiReply;
        }
        if (res.ok) {
          const out = fromGemini(reply, model);
          log("studio.ai.ok", { model, ms: Date.now() - started, tools: (request.tools ?? []).length, calls: out.output.filter((o) => o.type === "function_call").length });
          return Response.json(out);
        }
        errors.push(`${model}: HTTP ${res.status}`);
        log("studio.ai.error", { model, status: res.status, message: reply.error?.message?.slice(0, 200) });
        if (res.status === 429) coolDown.set(model, Date.now() + 60_000);
        // 429 = this model's free quota is used up, 503 = model busy: both mean "try another model".
        if (res.status === 429 || res.status === 503) retryable = true;
      } catch (e) {
        errors.push(`${model}: ${(e as Error).message}`);
        retryable = true;
      }
    }
    if (!retryable) break;
    if (round === 1) await sleep(5000);
  }
  return Response.json(failed(`The AI is busy or out of free quota right now. Try again in a minute. (${errors.slice(-4).join(" | ")})`));
}

function callGemini(model: string, body: Record<string, unknown>) {
  return fetchWithTimeout(
    `${GEMINI}/models/${model}:generateContent`,
    { method: "POST", headers: { "x-goog-api-key": env.geminiApiKey, "Content-Type": "application/json" }, body: JSON.stringify(body) },
    60_000,
  );
}
