import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  CreateOrderInputSchema,
  OPEN_TASK_STATUSES,
  TERMINAL_ORDER_STATUSES,
  canTransitionOrder,
  validateDag,
  type CreateOrderInput,
  type OrderStatus,
  type StationKind,
} from "@kds/contracts";
import {
  getDb,
  menuItems,
  orderEvents,
  orderItems,
  orders,
  qcInspections,
  recipes,
  stations,
  stores,
  tasks,
  users,
  type Tx,
} from "@kds/db";
import { audit, emit } from "./events.ts";
import { conflict, invalid, isUniqueViolation, notFound } from "./errors.ts";

export type OrderRow = typeof orders.$inferSelect;

export interface CreateOrderResult {
  order: OrderRow;
  created: boolean;
}

async function findByExternalId(storeId: string, source: OrderRow["source"], externalId: string) {
  const [o] = await getDb()
    .select()
    .from(orders)
    .where(and(eq(orders.storeId, storeId), eq(orders.source, source), eq(orders.externalId, externalId)))
    .limit(1);
  return o ?? null;
}

/**
 * Creates an order: freezes each item's published recipe, materialises the
 * recipe DAG into station tasks (roots READY, the rest BLOCKED), writes the
 * audit trail and outbox event — all in one transaction. Idempotent on
 * (store, source, externalId).
 */
export async function createOrder(
  storeId: string,
  rawInput: CreateOrderInput,
  actorId: string | null = null,
): Promise<CreateOrderResult> {
  const parsed = CreateOrderInputSchema.safeParse(rawInput);
  if (!parsed.success) throw invalid("Invalid order", parsed.error.flatten());
  const input = parsed.data;

  if (input.externalId) {
    const existing = await findByExternalId(storeId, input.source, input.externalId);
    if (existing) return { order: existing, created: false };
  }

  const db = getDb();
  try {
    return await db.transaction(async (tx) => {
      // Lock the store row: serialises order numbering.
      const [store] = await tx.select().from(stores).where(eq(stores.id, storeId)).for("update");
      if (!store) throw notFound("Store");

      const skus = [...new Set(input.items.map((i) => i.sku))];
      const products = await tx
        .select({ item: menuItems, recipe: recipes })
        .from(menuItems)
        .innerJoin(recipes, and(eq(recipes.menuItemId, menuItems.id), eq(recipes.status, "PUBLISHED")))
        .where(and(inArray(menuItems.sku, skus), eq(menuItems.active, true)));
      const bySku = new Map(products.map((p) => [p.item.sku, p]));
      const missing = skus.filter((s) => !bySku.has(s));
      if (missing.length) throw invalid(`Unknown or unpublished SKU(s): ${missing.join(", ")}`);

      const stationRows = await tx
        .select()
        .from(stations)
        .where(and(eq(stations.storeId, storeId), eq(stations.active, true)))
        .orderBy(asc(stations.sortOrder));
      const stationByKind = new Map<StationKind, string>();
      for (const s of stationRows) if (!stationByKind.has(s.kind)) stationByKind.set(s.kind, s.id);

      const allergens = new Set<string>();
      for (const i of input.items) for (const a of bySku.get(i.sku)!.recipe.body.allergens) allergens.add(a);

      const number = store.orderSeq + 1;
      await tx.update(stores).set({ orderSeq: number }).where(eq(stores.id, storeId));

      const [order] = await tx
        .insert(orders)
        .values({
          storeId,
          number,
          source: input.source,
          externalId: input.externalId ?? null,
          customerName: input.customerName,
          fulfillmentType: input.fulfillmentType,
          promisedAt: input.promisedAt,
          notes: input.notes,
          allergens: [...allergens].sort(),
        })
        .returning();

      const now = new Date();
      const stationIds = new Set<string>();
      for (const line of input.items) {
        const { item, recipe } = bySku.get(line.sku)!;
        const dag = validateDag(recipe.body.steps);
        if (!dag.ok) throw invalid(`Recipe for ${item.sku} is invalid: ${dag.errors.join("; ")}`);
        const [oi] = await tx
          .insert(orderItems)
          .values({
            orderId: order!.id,
            menuItemId: item.id,
            recipeId: recipe.id,
            name: item.name,
            sku: item.sku,
            quantity: line.quantity,
            notes: line.notes,
            recipeSnapshot: recipe.body,
          })
          .returning();
        await tx.insert(tasks).values(
          recipe.body.steps.map((s) => {
            const stationId = stationByKind.get(s.stationKind);
            if (!stationId) throw invalid(`No active ${s.stationKind} station in this store`);
            stationIds.add(stationId);
            const ready = s.dependsOn.length === 0;
            return {
              storeId,
              orderId: order!.id,
              orderItemId: oi!.id,
              stationId,
              stepKey: s.key,
              name: s.name,
              instructions: s.instructions,
              durationSec: s.durationSec,
              dependsOn: s.dependsOn,
              status: ready ? ("READY" as const) : ("BLOCKED" as const),
              readyAt: ready ? now : null,
            };
          }),
        );
      }

      await audit(tx, order!.id, "ORDER_CREATED", actorId, {
        source: input.source,
        externalId: input.externalId,
        items: input.items.map((i) => `${i.quantity}x ${i.sku}`),
      });
      await emit(tx, storeId, "ORDER_CREATED", {
        orderId: order!.id,
        number,
        stationIds: [...stationIds],
      });
      return { order: order!, created: true };
    });
  } catch (e) {
    // Two concurrent deliveries of the same external order: the loser returns the winner's row.
    if (input.externalId && isUniqueViolation(e)) {
      const existing = await findByExternalId(storeId, input.source, input.externalId);
      if (existing) return { order: existing, created: false };
    }
    throw e;
  }
}

/**
 * Derives the order status from its items and moves the order there. Call
 * inside a transaction after any item/task change. Returns the new status if it changed.
 */
export async function recomputeOrderStatus(tx: Tx, orderId: string, actorId: string | null): Promise<OrderStatus | null> {
  const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
  if (!order || TERMINAL_ORDER_STATUSES.includes(order.status)) return null;
  if (order.status === "STAGED") return null;

  const items = await tx.select({ status: orderItems.status }).from(orderItems).where(eq(orderItems.orderId, orderId));
  const live = items.filter((i) => i.status !== "CANCELLED");
  let next: OrderStatus;
  if (live.length > 0 && live.every((i) => i.status === "QC_PASSED")) next = "READY";
  else if (live.some((i) => i.status === "IN_PRODUCTION" || i.status === "REWORK")) {
    const [started] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(tasks)
      .where(and(eq(tasks.orderId, orderId), sql`${tasks.startedAt} is not null`));
    next = order.status === "NEW" && !started?.n ? "NEW" : "IN_PRODUCTION";
  } else next = "QC";

  if (next === order.status || !canTransitionOrder(order.status, next)) return null;
  await tx
    .update(orders)
    .set({ status: next, version: order.version + 1, readyAt: next === "READY" ? new Date() : order.readyAt })
    .where(eq(orders.id, orderId));
  await audit(tx, orderId, `ORDER_${next}`, actorId, { from: order.status });
  await emit(tx, order.storeId, "ORDER_UPDATED", { orderId, status: next });
  return next;
}

/** Cancels an open order and every open task on it. */
export async function cancelOrder(storeId: string, orderId: string, actorId: string | null, reason = "") {
  return getDb().transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.storeId, storeId)))
      .for("update");
    if (!order) throw notFound("Order");
    if (TERMINAL_ORDER_STATUSES.includes(order.status)) throw conflict(`Order is already ${order.status}`);

    const cancelledTasks = await tx
      .update(tasks)
      .set({ status: "CANCELLED", version: sql`${tasks.version} + 1` })
      .where(and(eq(tasks.orderId, orderId), inArray(tasks.status, [...OPEN_TASK_STATUSES])))
      .returning({ stationId: tasks.stationId });
    await tx.update(orderItems).set({ status: "CANCELLED" }).where(eq(orderItems.orderId, orderId));
    const [updated] = await tx
      .update(orders)
      .set({ status: "CANCELLED", cancelledAt: new Date(), version: order.version + 1 })
      .where(eq(orders.id, orderId))
      .returning();
    await audit(tx, orderId, "ORDER_CANCELLED", actorId, { reason, from: order.status });
    await emit(tx, storeId, "ORDER_CANCELLED", {
      orderId,
      number: order.number,
      stationIds: [...new Set(cancelledTasks.map((t) => t.stationId))],
    });
    return updated!;
  });
}

export async function listOrders(storeId: string, opts: { status?: OrderStatus; limit?: number } = {}) {
  const db = getDb();
  return db
    .select({
      id: orders.id,
      number: orders.number,
      customerName: orders.customerName,
      source: orders.source,
      fulfillmentType: orders.fulfillmentType,
      status: orders.status,
      promisedAt: orders.promisedAt,
      createdAt: orders.createdAt,
      completedAt: orders.completedAt,
      itemCount: sql<number>`(select coalesce(sum(${orderItems.quantity}),0)::int from ${orderItems} where ${orderItems.orderId} = ${orders.id})`,
    })
    .from(orders)
    .where(opts.status ? and(eq(orders.storeId, storeId), eq(orders.status, opts.status)) : eq(orders.storeId, storeId))
    .orderBy(desc(orders.createdAt))
    .limit(opts.limit ?? 200);
}

export async function getOrderDetail(storeId: string, orderId: string) {
  const db = getDb();
  const [order] = await db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.storeId, storeId)));
  if (!order) throw notFound("Order");
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  const taskRows = await db
    .select({ task: tasks, stationName: stations.name, claimedByName: users.name })
    .from(tasks)
    .innerJoin(stations, eq(stations.id, tasks.stationId))
    .leftJoin(users, eq(users.id, tasks.claimedBy))
    .where(eq(tasks.orderId, orderId))
    .orderBy(asc(tasks.createdAt));
  const events = await db
    .select({ event: orderEvents, actorName: users.name })
    .from(orderEvents)
    .leftJoin(users, eq(users.id, orderEvents.actorId))
    .where(eq(orderEvents.orderId, orderId))
    .orderBy(asc(orderEvents.createdAt));
  const inspections = items.length
    ? await db
        .select({ inspection: qcInspections, inspectorName: users.name })
        .from(qcInspections)
        .innerJoin(users, eq(users.id, qcInspections.inspectorId))
        .where(inArray(qcInspections.orderItemId, items.map((i) => i.id)))
        .orderBy(asc(qcInspections.createdAt))
    : [];
  return { order, items, tasks: taskRows, events, inspections };
}
