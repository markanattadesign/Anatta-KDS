import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { QcInspectionInputSchema, type QcInspectionInput } from "@kds/contracts";
import { getDb, orderItems, orders, qcInspections, stations, tasks, type Tx } from "@kds/db";
import { audit, emit } from "./events.ts";
import { conflict, invalid, notFound } from "./errors.ts";
import { recomputeOrderStatus } from "./orders.ts";

/** Items waiting for inspection, most urgent promise time first. */
export async function getQcQueue(storeId: string) {
  const db = getDb();
  const rows = await db
    .select({
      item: orderItems,
      order: {
        id: orders.id,
        number: orders.number,
        customerName: orders.customerName,
        fulfillmentType: orders.fulfillmentType,
        promisedAt: orders.promisedAt,
        allergens: orders.allergens,
        notes: orders.notes,
      },
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(eq(orders.storeId, storeId), eq(orderItems.status, "QC_PENDING"), ne(orders.status, "CANCELLED")))
    .orderBy(asc(orders.promisedAt));
  const ids = rows.map((r) => r.item.id);
  const history = ids.length
    ? await db
        .select()
        .from(qcInspections)
        .where(inArray(qcInspections.orderItemId, ids))
        .orderBy(desc(qcInspections.createdAt))
    : [];
  return {
    items: rows.map((r) => ({ ...r, previousFails: history.filter((h) => h.orderItemId === r.item.id && h.result === "FAIL") })),
    serverTime: new Date().toISOString(),
  };
}

/**
 * Records a QC verdict. PASS moves the item to QC_PASSED (and the order to
 * READY once every item has passed). FAIL records defect codes and spawns a
 * READY rework task at the Assembly station; when that task is completed the
 * item returns to the QC queue.
 */
export async function inspectItem(storeId: string, orderItemId: string, rawInput: QcInspectionInput, inspectorId: string) {
  const parsed = QcInspectionInputSchema.safeParse(rawInput);
  if (!parsed.success) throw invalid("Invalid inspection", parsed.error.flatten());
  const input = parsed.data;

  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .select({ item: orderItems, order: orders })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(and(eq(orderItems.id, orderItemId), eq(orders.storeId, storeId)))
      .for("update", { of: orderItems });
    if (!row) throw notFound("Item");
    const { item, order } = row;
    if (item.status !== "QC_PENDING") throw conflict(`Item is ${item.status.replace("_", " ").toLowerCase()}, not awaiting QC`);

    const [inspection] = await tx
      .insert(qcInspections)
      .values({
        orderItemId,
        inspectorId,
        result: input.result,
        checklist: input.checklist,
        defectCodes: input.defectCodes,
        notes: input.notes,
      })
      .returning();

    const attempts = item.qcAttempts + 1;
    const stationIds: string[] = [];
    if (input.result === "PASS") {
      await tx
        .update(orderItems)
        .set({ status: "QC_PASSED", qcAttempts: attempts, version: item.version + 1 })
        .where(eq(orderItems.id, orderItemId));
      await audit(tx, order.id, "QC_PASSED", inspectorId, { item: item.name, attempt: attempts });
    } else {
      const station = await reworkStation(tx, storeId, orderItemId);
      await tx.insert(tasks).values({
        storeId,
        orderId: order.id,
        orderItemId,
        stationId: station,
        stepKey: `rework-${attempts}`,
        sortOrder: 100 + attempts,
        name: `Rework: ${item.name}`,
        instructions: [input.defectCodes.map((c) => c.replaceAll("_", " ").toLowerCase()).join(", "), input.notes]
          .filter(Boolean)
          .join(" — "),
        durationSec: 300,
        dependsOn: [],
        status: "READY",
        isRework: true,
        readyAt: new Date(),
      });
      stationIds.push(station);
      await tx
        .update(orderItems)
        .set({ status: "REWORK", qcAttempts: attempts, version: item.version + 1 })
        .where(eq(orderItems.id, orderItemId));
      await audit(tx, order.id, "QC_FAILED", inspectorId, {
        item: item.name,
        attempt: attempts,
        defectCodes: input.defectCodes,
        notes: input.notes,
      });
    }
    await recomputeOrderStatus(tx, order.id, inspectorId);
    await emit(tx, storeId, "QC_RESULT", { orderId: order.id, orderItemId, result: input.result, stationIds });
    return inspection!;
  });
}

/** Rework goes to Assembly; if the store has none, to the station of the item's last non-packaging step. */
async function reworkStation(tx: Tx, storeId: string, orderItemId: string) {
  const [assembly] = await tx
    .select({ id: stations.id })
    .from(stations)
    .where(and(eq(stations.storeId, storeId), eq(stations.kind, "ASSEMBLY"), eq(stations.active, true)))
    .orderBy(asc(stations.sortOrder))
    .limit(1);
  if (assembly) return assembly.id;
  const itemTasks = await tx
    .select({ stationId: tasks.stationId, kind: stations.kind })
    .from(tasks)
    .innerJoin(stations, eq(stations.id, tasks.stationId))
    .where(eq(tasks.orderItemId, orderItemId))
    .orderBy(desc(tasks.createdAt));
  const pick = itemTasks.find((t) => t.kind !== "PACKAGING") ?? itemTasks[0];
  if (!pick) throw conflict("No station available for rework");
  return pick.stationId;
}
