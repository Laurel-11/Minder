import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Schema } from "../ai";

const verdict: Schema = {
  type: "OBJECT",
  properties: {
    verdict: { type: "STRING", enum: ["approve", "hold", "block"] },
    flags: { type: "ARRAY", items: { type: "STRING" } },
    note: { type: "STRING", nullable: true },
  },
  required: ["verdict", "flags"],
};

describe("schema checks on JSON answers", async () => {
  const { shapeProblem, toJsonSchema } = await import("../ai");
  it("accepts an answer of the right shape", () => {
    expect(shapeProblem({ verdict: "hold", flags: ["x"], note: null }, verdict)).toBeNull();
  });
  it("names the first problem", () => {
    expect(shapeProblem({ flags: [] }, verdict)).toBe("answer.verdict is missing");
    expect(shapeProblem({ verdict: "maybe", flags: [] }, verdict)).toContain("not one of approve, hold, block");
    expect(shapeProblem({ verdict: "hold", flags: [3] }, verdict)).toBe("answer.flags[0] is not text");
  });
  it("turns Gemini's schema into standard JSON Schema for DeepSeek", () => {
    const j = toJsonSchema(verdict) as { type: string; properties: Record<string, { type: unknown }> };
    expect(j.type).toBe("object");
    expect(j.properties.note.type).toEqual(["string", "null"]);
  });
});

describe("recorded answers when no AI answers", () => {
  it("uses the recorded answer for the same request, and only for it", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "minder-replay-"));
    const file = path.join(dir, "ai-replay.json");
    vi.stubEnv("AI_REPLAY_FILE", file);
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.resetModules();
    const { generateJson, replayId, AiUnavailableError } = await import("../ai");
    fs.writeFileSync(
      file,
      JSON.stringify({ [replayId("review|Bean & Leaf|coffee")]: { label: "Review", model: "deepseek-flash", recordedAt: "2026-11-05T00:00:00Z", data: { verdict: "approve", flags: [] } } }),
    );
    const known = await generateJson({ system: "s", prompt: "p", schema: verdict, replay: { key: "review|Bean & Leaf|coffee", label: "Review" } });
    expect(known.recorded).toBe(true);
    expect(known.model).toContain("recorded 2026-11-05");
    expect(known.data).toEqual({ verdict: "approve", flags: [] });
    await expect(generateJson({ system: "s", prompt: "p", schema: verdict, replay: { key: "review|Some other store|tv", label: "x" } })).rejects.toBeInstanceOf(
      AiUnavailableError,
    );
    vi.unstubAllEnvs();
  });
});
