import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import {
  OPEN_TASK_STATUSES,
  ROLE_RANK,
  nextTaskStatus,
  type Role,
  type TaskAction,
} from "@kds/contracts";
import { getDb, orderItems, orders, stations, tasks, users, type Tx } from "@kds/db";
import { audit, emit } from "./events.ts";
import { conflict, forbidden, notFound } from "./errors.ts";
import { recomputeOrderStatus } from "./orders.ts";

export type TaskRow = typeof tasks.$inferSelect;

const AUDITED: Partial<Record<TaskAction, string>> = {
  start: "TASK_STARTED",
  complete: "TASK_COMPLETED",
  hold: "TASK_HELD",
  resume: "TASK_RESUMED",
};

/**
 * Applies a state-machine action to a task. The task row is locked
 * (SELECT ... FOR UPDATE) and, if the caller passes `expectedVersion`, checked
 * against the current version, so two tablets tapping the same ticket can't
 * both win. Completing a task unblocks its dependants and may move the item to QC.
 */
export async function transitionTask(
  storeId: string,
  taskId: string,
  action: TaskAction,
  actor: { id: string; role: Role },
  opts: { expectedVersion?: number; reason?: string } = {},
): Promise<TaskRow> {
  return getDb().transaction(async (tx) => {
    const [task] = await tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.storeId, storeId)))
      .for("update");
    if (!task) throw notFound("Task");
    if (opts.expectedVersion !== undefined && opts.expectedVersion !== task.version) {
      throw conflict("This ticket was updated on another screen. Refreshed.", { currentVersion: task.version });
    }
    const next = nextTaskStatus(task.status, action);
    if (!next) throw conflict(`Can't ${action} a task that is ${task.status.replace("_", " ").toLowerCase()}`);

    const isManager = ROLE_RANK[actor.role] >= ROLE_RANK.MANAGER;
    if (task.claimedBy && task.claimedBy !== actor.id && action !== "claim" && !isManager) {
      throw forbidden("This task is claimed by someone else");
    }

    const now = new Date();
    const patch: Partial<TaskRow> = { status: next, version: task.version + 1 };
    if (action === "claim") patch.claimedBy = actor.id;
    if (action === "unclaim") patch.claimedBy = null;
    if (action === "start") {
      patch.claimedBy = task.claimedBy ?? actor.id;
      patch.startedAt = task.startedAt ?? now;
    }
    if (action === "complete") patch.completedAt = now;
    if (action === "hold") patch.holdReason = opts.reason?.trim() || "On hold";
    if (action === "resume") patch.holdReason = null;

    const [updated] = await tx.update(tasks).set(patch).where(eq(tasks.id, taskId)).returning();

    const touchedStations = new Set([task.stationId]);
    if (action === "complete") {
      for (const s of await advanceItem(tx, task.orderItemId)) touchedStations.add(s);
    }
    if (AUDITED[action]) {
      await audit(tx, task.orderId, AUDITED[action]!, actor.id, {
        taskId,
        task: task.name,
        ...(action === "hold" ? { reason: patch.holdReason } : {}),
      });
    }
    await recomputeOrderStatus(tx, task.orderId, actor.id);
    await emit(tx, storeId, "TASK_UPDATED", {
      taskId,
      orderId: task.orderId,
      status: next,
      stationIds: [...touchedStations],
    });
    return updated!;
  });
}

/**
 * After a task completes: mark BLOCKED tasks whose dependencies are now all
 * DONE as READY; if every task on the item is DONE, send the item to QC.
 * Returns the station ids whose queues changed.
 */
async function advanceItem(tx: Tx, orderItemId: string): Promise<string[]> {
  const siblings = await tx
    .select()
    .from(tasks)
    .where(and(eq(tasks.orderItemId, orderItemId), ne(tasks.status, "CANCELLED")))
    .for("update");
  const done = new Set(siblings.filter((t) => t.status === "DONE").map((t) => t.stepKey));
  const now = new Date();
  const changed: string[] = [];
  for (const t of siblings) {
    if (t.status === "BLOCKED" && t.dependsOn.every((d) => done.has(d))) {
      await tx
        .update(tasks)
        .set({ status: "READY", readyAt: now, version: t.version + 1 })
        .where(eq(tasks.id, t.id));
      changed.push(t.stationId);
    }
  }
  if (siblings.every((t) => t.status === "DONE")) {
    const [item] = await tx.select().from(orderItems).where(eq(orderItems.id, orderItemId)).for("update");
    if (item && (item.status === "IN_PRODUCTION" || item.status === "REWORK")) {
      await tx
        .update(orderItems)
        .set({ status: "QC_PENDING", version: item.version + 1 })
        .where(eq(orderItems.id, orderItemId));
      await audit(tx, item.orderId, "ITEM_QC_PENDING", null, { item: item.name, orderItemId });
    }
  }
  return changed;
}

/** Everything a station board needs: open tasks with their order context, plus what blocked tasks wait on. */
export async function getStationQueue(storeId: string, stationId: string) {
  const db = getDb();
  const [station] = await db
    .select()
    .from(stations)
    .where(and(eq(stations.id, stationId), eq(stations.storeId, storeId)));
  if (!station) throw notFound("Station");

  const rows = await db
    .select({
      task: tasks,
      claimedByName: users.name,
      order: {
        id: orders.id,
        number: orders.number,
        customerName: orders.customerName,
        fulfillmentType: orders.fulfillmentType,
        promisedAt: orders.promisedAt,
        notes: orders.notes,
        allergens: orders.allergens,
        status: orders.status,
        createdAt: orders.createdAt,
      },
      item: {
        id: orderItems.id,
        name: orderItems.name,
        sku: orderItems.sku,
        quantity: orderItems.quantity,
        notes: orderItems.notes,
      },
    })
    .from(tasks)
    .innerJoin(orders, eq(orders.id, tasks.orderId))
    .innerJoin(orderItems, eq(orderItems.id, tasks.orderItemId))
    .leftJoin(users, eq(users.id, tasks.claimedBy))
    .where(
      and(
        eq(tasks.stationId, stationId),
        inArray(tasks.status, [...OPEN_TASK_STATUSES]),
        ne(orders.status, "CANCELLED"),
      ),
    )
    .orderBy(asc(orders.createdAt), asc(tasks.createdAt));

  // For blocked tasks: which sibling steps are they waiting on, and where?
  const itemIds = [...new Set(rows.filter((r) => r.task.status === "BLOCKED").map((r) => r.item.id))];
  const siblings = itemIds.length
    ? await db
        .select({
          orderItemId: tasks.orderItemId,
          stepKey: tasks.stepKey,
          name: tasks.name,
          status: tasks.status,
          stationName: stations.name,
        })
        .from(tasks)
        .innerJoin(stations, eq(stations.id, tasks.stationId))
        .where(inArray(tasks.orderItemId, itemIds))
    : [];

  return {
    station,
    tasks: rows.map((r) => ({
      ...r,
      waitingOn:
        r.task.status === "BLOCKED"
          ? siblings
              .filter((s) => s.orderItemId === r.item.id && r.task.dependsOn.includes(s.stepKey) && s.status !== "DONE")
              .map((s) => ({ name: s.name, status: s.status, stationName: s.stationName }))
          : [],
    })),
    serverTime: new Date().toISOString(),
  };
}

/** Station-level task counts, used for nav badges. */
export async function stationOpenCounts(storeId: string) {
  return getDb()
    .select({ stationId: tasks.stationId, n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(and(eq(tasks.storeId, storeId), inArray(tasks.status, ["READY", "CLAIMED", "IN_PROGRESS", "ON_HOLD"])))
    .groupBy(tasks.stationId);
}
