import { and, asc, eq, inArray, notInArray } from "drizzle-orm";
import { StageInputSchema } from "@kds/contracts";
import { getDb, orderItems, orders, stations, tasks, type Tx } from "@kds/db";
import { audit, emit } from "./events.ts";
import { conflict, invalid, notFound } from "./errors.ts";

/** Open orders with per-station progress, for the Fulfillment (expo) board. */
export async function getExpoQueue(storeId: string) {
  const db = getDb();
  const open = await db
    .select()
    .from(orders)
    .where(and(eq(orders.storeId, storeId), notInArray(orders.status, ["COMPLETED", "CANCELLED"])))
    .orderBy(asc(orders.promisedAt));
  const ids = open.map((o) => o.id);
  const [items, taskRows, stationRows] = ids.length
    ? await Promise.all([
        db.select().from(orderItems).where(inArray(orderItems.orderId, ids)),
        db
          .select({ orderId: tasks.orderId, stationId: tasks.stationId, status: tasks.status })
          .from(tasks)
          .where(inArray(tasks.orderId, ids)),
        db.select().from(stations).where(eq(stations.storeId, storeId)).orderBy(asc(stations.sortOrder)),
      ])
    : [[], [], []];

  return {
    orders: open.map((o) => {
      const t = taskRows.filter((r) => r.orderId === o.id && r.status !== "CANCELLED");
      return {
        ...o,
        items: items
          .filter((i) => i.orderId === o.id)
          .map((i) => ({ id: i.id, name: i.name, quantity: i.quantity, status: i.status })),
        progress: stationRows
          .map((s) => {
            const st = t.filter((r) => r.stationId === s.id);
            return { stationId: s.id, stationName: s.name, done: st.filter((r) => r.status === "DONE").length, total: st.length };
          })
          .filter((p) => p.total > 0),
      };
    }),
    serverTime: new Date().toISOString(),
  };
}

async function lockOrder(tx: Tx, storeId: string, orderId: string) {
  const [o] = await tx
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.storeId, storeId)))
    .for("update");
  if (!o) throw notFound("Order");
  return o;
}

/** Puts a READY order on a staging shelf (or moves an already-staged one). */
export async function stageOrder(storeId: string, orderId: string, raw: unknown, actorId: string) {
  const parsed = StageInputSchema.safeParse(raw);
  if (!parsed.success) throw invalid("Invalid staging details", parsed.error.flatten());
  return getDb().transaction(async (tx) => {
    const o = await lockOrder(tx, storeId, orderId);
    if (o.status !== "READY" && o.status !== "STAGED") throw conflict(`Only ready orders can be staged (order is ${o.status})`);
    const [u] = await tx
      .update(orders)
      .set({
        status: "STAGED",
        stagingLocation: parsed.data.location,
        packageCount: parsed.data.packageCount,
        version: o.version + 1,
      })
      .where(eq(orders.id, orderId))
      .returning();
    await audit(tx, orderId, "ORDER_STAGED", actorId, parsed.data);
    await emit(tx, storeId, "ORDER_UPDATED", { orderId, status: "STAGED" });
    return u!;
  });
}

/** Hands the order to the customer/driver. */
export async function handoffOrder(storeId: string, orderId: string, actorId: string) {
  return getDb().transaction(async (tx) => {
    const o = await lockOrder(tx, storeId, orderId);
    if (o.status !== "READY" && o.status !== "STAGED") throw conflict(`Only ready or staged orders can be handed off (order is ${o.status})`);
    const [u] = await tx
      .update(orders)
      .set({ status: "COMPLETED", completedAt: new Date(), version: o.version + 1 })
      .where(eq(orders.id, orderId))
      .returning();
    await audit(tx, orderId, "ORDER_HANDED_OFF", actorId, { fulfillmentType: o.fulfillmentType });
    await emit(tx, storeId, "ORDER_UPDATED", { orderId, status: "COMPLETED" });
    return u!;
  });
}
