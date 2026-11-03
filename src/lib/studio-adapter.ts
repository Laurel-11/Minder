// Browser half of the AG Studio <-> Gemini adapter. Implements AG Studio's AgLlmAdapter by forwarding
// each turn to /api/studio-llm and replaying the answer as AG-UI events.
import type { AgAiEvent, AgLlmAdapter, AgLlmResponse } from "ag-studio";

export const geminiAdapter: AgLlmAdapter = {
  executeTurn(request, options) {
    const complete: Promise<AgLlmResponse> = fetch("/api/studio-llm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: options?.signal,
    })
      .then((r) => r.json() as Promise<AgLlmResponse>)
      .catch((e: Error) => ({
        id: "failed",
        createdAt: Date.now(),
        status: options?.signal?.aborted ? ("cancelled" as const) : ("failed" as const),
        output: [],
        error: { code: "network", message: e.message },
      }));

    async function* events(): AsyncGenerator<AgAiEvent> {
      const res = await complete;
      for (const item of res.output) {
        if (item.type === "message") {
          const text = item.content.map((c) => (c.type === "text" ? c.text : c.refusal)).join("");
          if (!text) continue;
          yield { type: "TEXT_MESSAGE_START", messageId: item.id, role: "assistant" };
          yield { type: "TEXT_MESSAGE_CONTENT", messageId: item.id, delta: text };
          yield { type: "TEXT_MESSAGE_END", messageId: item.id };
        } else if (item.type === "function_call") {
          yield { type: "TOOL_CALL_START", toolCallId: item.callId, toolCallName: item.name };
          yield { type: "TOOL_CALL_ARGS", toolCallId: item.callId, delta: item.arguments };
          yield { type: "TOOL_CALL_END", toolCallId: item.callId };
        }
      }
    }

    return { stream: { [Symbol.asyncIterator]: () => events() }, complete };
  },
};
