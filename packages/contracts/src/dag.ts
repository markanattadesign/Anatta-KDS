import type { RecipeStep } from "./schemas.ts";

export type DagResult = { ok: true; order: string[] } | { ok: false; errors: string[] };

/**
 * Validates a recipe's step graph: unique keys, known dependencies, no
 * self-dependency and no cycles. Returns a topological order on success.
 */
export function validateDag(steps: Pick<RecipeStep, "key" | "dependsOn">[]): DagResult {
  const errors: string[] = [];
  const keys = new Set<string>();
  for (const s of steps) {
    if (keys.has(s.key)) errors.push(`Duplicate step key "${s.key}"`);
    keys.add(s.key);
  }
  for (const s of steps) {
    for (const d of s.dependsOn) {
      if (d === s.key) errors.push(`Step "${s.key}" depends on itself`);
      else if (!keys.has(d)) errors.push(`Step "${s.key}" depends on unknown step "${d}"`);
    }
  }
  if (errors.length) return { ok: false, errors };

  // Kahn's algorithm, stable by input order.
  const indegree = new Map(steps.map((s) => [s.key, new Set(s.dependsOn).size]));
  const order: string[] = [];
  const queue = steps.filter((s) => indegree.get(s.key) === 0).map((s) => s.key);
  while (queue.length) {
    const k = queue.shift()!;
    order.push(k);
    for (const s of steps) {
      if (s.dependsOn.includes(k)) {
        const n = indegree.get(s.key)! - 1;
        indegree.set(s.key, n);
        if (n === 0) queue.push(s.key);
      }
    }
  }
  if (order.length !== steps.length) {
    const stuck = steps.filter((s) => !order.includes(s.key)).map((s) => s.key);
    return { ok: false, errors: [`Cycle detected among steps: ${stuck.join(", ")}`] };
  }
  return { ok: true, order };
}

/** Keys whose dependencies are all in `done` and which aren't done themselves. */
export function readySteps(
  steps: Pick<RecipeStep, "key" | "dependsOn">[],
  done: ReadonlySet<string>,
): string[] {
  return steps.filter((s) => !done.has(s.key) && s.dependsOn.every((d) => done.has(d))).map((s) => s.key);
}

/** Longest dependency path in seconds (critical path) — the minimum production time. */
export function criticalPathSec(steps: Pick<RecipeStep, "key" | "dependsOn" | "durationSec">[]): number {
  const dag = validateDag(steps);
  if (!dag.ok) throw new Error(dag.errors.join("; "));
  const byKey = new Map(steps.map((s) => [s.key, s]));
  const finish = new Map<string, number>();
  for (const k of dag.order) {
    const s = byKey.get(k)!;
    const start = Math.max(0, ...s.dependsOn.map((d) => finish.get(d) ?? 0));
    finish.set(k, start + s.durationSec);
  }
  return Math.max(0, ...finish.values());
}
