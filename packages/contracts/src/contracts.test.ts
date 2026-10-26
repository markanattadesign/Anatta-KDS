import { describe, expect, it } from "vitest";
import {
  DEMO_PRODUCTS,
  QcInspectionInputSchema,
  RecipeSchema,
  allowedTaskActions,
  criticalPathSec,
  nextTaskStatus,
  readySteps,
  validateDag,
} from "./index.ts";

describe("validateDag", () => {
  it("accepts every demo recipe", () => {
    for (const p of DEMO_PRODUCTS) {
      expect(RecipeSchema.safeParse(p.recipe).success).toBe(true);
      expect(validateDag(p.recipe.steps).ok).toBe(true);
    }
  });
  it("rejects cycles, unknown deps, self deps and duplicates", () => {
    expect(validateDag([{ key: "a", dependsOn: ["b"] }, { key: "b", dependsOn: ["a"] }]).ok).toBe(false);
    expect(validateDag([{ key: "a", dependsOn: ["zzz"] }]).ok).toBe(false);
    expect(validateDag([{ key: "a", dependsOn: ["a"] }]).ok).toBe(false);
    expect(validateDag([{ key: "a", dependsOn: [] }, { key: "a", dependsOn: [] }]).ok).toBe(false);
  });
  it("returns a topological order", () => {
    const r = validateDag([
      { key: "c", dependsOn: ["a", "b"] },
      { key: "a", dependsOn: [] },
      { key: "b", dependsOn: ["a"] },
    ]);
    expect(r).toEqual({ ok: true, order: ["a", "b", "c"] });
  });
});

describe("readySteps / criticalPath", () => {
  const steps = DEMO_PRODUCTS[0]!.recipe.steps;
  it("unblocks a join only once all parents are done", () => {
    expect(readySteps(steps, new Set())).toEqual(["melon", "pineapple"]);
    expect(readySteps(steps, new Set(["melon"]))).toEqual(["pineapple"]);
    expect(readySteps(steps, new Set(["melon", "pineapple"]))).toEqual(["assemble"]);
  });
  it("computes the critical path", () => {
    expect(criticalPathSec(steps)).toBe(300 + 360 + 120);
  });
});

describe("task state machine", () => {
  it("allows the happy path and rejects illegal moves", () => {
    expect(nextTaskStatus("READY", "claim")).toBe("CLAIMED");
    expect(nextTaskStatus("CLAIMED", "start")).toBe("IN_PROGRESS");
    expect(nextTaskStatus("IN_PROGRESS", "complete")).toBe("DONE");
    expect(nextTaskStatus("BLOCKED", "start")).toBeNull();
    expect(nextTaskStatus("DONE", "start")).toBeNull();
    expect(allowedTaskActions("ON_HOLD")).toEqual(["resume"]);
  });
});

describe("QC input", () => {
  it("requires a defect code on fail", () => {
    expect(QcInspectionInputSchema.safeParse({ result: "FAIL" }).success).toBe(false);
    expect(QcInspectionInputSchema.safeParse({ result: "FAIL", defectCodes: ["OTHER"] }).success).toBe(true);
  });
});
