import type { OrderStatus, TaskAction, TaskStatus } from "./schemas.ts";

/** Task transitions: action -> (from statuses) -> to status. */
export const TASK_TRANSITIONS: Record<TaskAction, { from: readonly TaskStatus[]; to: TaskStatus }> = {
  claim: { from: ["READY"], to: "CLAIMED" },
  unclaim: { from: ["CLAIMED"], to: "READY" },
  start: { from: ["READY", "CLAIMED"], to: "IN_PROGRESS" },
  complete: { from: ["IN_PROGRESS"], to: "DONE" },
  hold: { from: ["CLAIMED", "IN_PROGRESS"], to: "ON_HOLD" },
  resume: { from: ["ON_HOLD"], to: "IN_PROGRESS" },
};

export function nextTaskStatus(current: TaskStatus, action: TaskAction): TaskStatus | null {
  const t = TASK_TRANSITIONS[action];
  return t.from.includes(current) ? t.to : null;
}

export function allowedTaskActions(current: TaskStatus): TaskAction[] {
  return (Object.keys(TASK_TRANSITIONS) as TaskAction[]).filter((a) =>
    TASK_TRANSITIONS[a].from.includes(current),
  );
}

export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  NEW: ["IN_PRODUCTION", "QC", "CANCELLED"],
  IN_PRODUCTION: ["QC", "CANCELLED"],
  QC: ["IN_PRODUCTION", "READY", "CANCELLED"],
  READY: ["STAGED", "COMPLETED", "CANCELLED"],
  STAGED: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return from === to || ORDER_TRANSITIONS[from].includes(to);
}

export const OPEN_TASK_STATUSES: readonly TaskStatus[] = ["BLOCKED", "READY", "CLAIMED", "IN_PROGRESS", "ON_HOLD"];
export const TERMINAL_ORDER_STATUSES: readonly OrderStatus[] = ["COMPLETED", "CANCELLED"];
