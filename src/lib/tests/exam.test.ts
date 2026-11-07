// The exam itself: well-formed cases, and the right split between what code decides and what only the AI review can catch.
import { describe, expect, it } from "vitest";
import { DEMO_POLICY } from "../seed";
import { EXAM, examHistory } from "../exam-cases";
import { examSummary, grade, type ExamRow } from "../exam-run";
import { evaluateRules } from "../rules";
import { parsePurchaseRequest } from "../validate";

const now = new Date("2026-11-07T12:00:00Z");

describe("the exam", () => {
  it("has 60 cases with unique ids, each a valid purchase request", () => {
    expect(EXAM).toHaveLength(60);
    expect(new Set(EXAM.map((c) => c.id)).size).toBe(EXAM.length);
    for (const c of EXAM) {
      const parsed = parsePurchaseRequest(c.request);
      expect(parsed.ok, c.id).toBe(true);
      if (parsed.ok) expect(parsed.value.items, c.id).toEqual(c.request.items);
    }
  });

  it("leaves every trick, shady store and normal purchase to the AI review: the code limits pass them all", () => {
    for (const c of EXAM.filter((x) => x.group !== "rule")) expect(evaluateRules(DEMO_POLICY, c.request, examHistory(c, now), now).outcome, c.id).toBe("approve");
  });

  it("decides every hard-rule case in code, before any AI looks at it", () => {
    for (const c of EXAM.filter((x) => x.group === "rule")) expect(c.expect, c.id).toContain(evaluateRules(DEMO_POLICY, c.request, examHistory(c, now), now).outcome);
  });

  it("counts an AI that did not answer as a failure, never a pass", () => {
    const c = EXAM.find((x) => x.expect.includes("hold"))!;
    expect(grade(c, { decision: "hold", ruleOutcome: "approve", ruleStops: [], ai: null, aiError: "timeout", ms: 1 })).toBe("fail");
  });

  it("reports false alarms on normal purchases next to the tricks it caught", () => {
    const rows: ExamRow[] = EXAM.map((c) => ({
      c,
      state: "pass",
      result: { decision: c.group === "normal" ? "hold" : c.expect[0], ruleOutcome: "approve", ruleStops: [], ai: null, ms: 1 },
    }));
    const lines = examSummary(rows);
    expect(lines[0]).toBe("Tricks caught: 27 of 27 (27 blocked, 0 held for Maya).");
    expect(lines[1]).toBe("Of those, the 8 written from our interviews: 8 caught.");
    expect(lines[2]).toBe("Normal purchases paid: 0 of 22 (22 needlessly asked Maya, 0 wrongly blocked).");
  });
});
