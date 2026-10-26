import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, getDb, orders, orderItems } from "@kds/db";
import {
  DomainError,
  cancelOrder,
  createOrder,
  getExpoQueue,
  getOrderDetail,
  getOverview,
  getQcQueue,
  getStationQueue,
  handoffOrder,
  ingestDemoWebhook,
  inspectItem,
  readOutbox,
  signDemoPayload,
  stageOrder,
  transitionTask,
} from "../src/index.ts";
import { inMinutes, resetDb, taskByKey, tasksFor } from "./helpers.ts";

let ctx: Awaited<ReturnType<typeof resetDb>>;
beforeAll(async () => {
  ctx = await resetDb();
});
afterAll(async () => {
  await closeDb();
});

const bouquet = () =>
  createOrder(ctx.storeId, {
    customerName: "Jordan",
    fulfillmentType: "PICKUP",
    promisedAt: inMinutes(60),
    items: [{ sku: "SB-01", quantity: 1 }],
  });

async function run(orderId: string, key: string, actor = ctx.associate) {
  const t = await taskByKey(orderId, key);
  await transitionTask(ctx.storeId, t.id, "start", actor);
  await transitionTask(ctx.storeId, t.id, "complete", actor);
}

async function expectError(p: Promise<unknown>, code: DomainError["code"]) {
  await expect(p).rejects.toMatchObject({ code });
}

describe("order intake", () => {
  it("materialises the recipe DAG: roots READY, others BLOCKED", async () => {
    const { order, created } = await bouquet();
    expect(created).toBe(true);
    const ts = await tasksFor(order.id);
    const status = Object.fromEntries(ts.map((t) => [t.stepKey, t.status]));
    expect(status).toEqual({ melon: "READY", pineapple: "READY", assemble: "BLOCKED", package: "BLOCKED" });
    const fruit = await getStationQueue(ctx.storeId, ctx.stations.FRUIT!);
    expect(fruit.tasks.filter((t) => t.order.id === order.id)).toHaveLength(2);
  });

  it("collects allergens from recipes onto the order", async () => {
    const { order } = await createOrder(ctx.storeId, {
      customerName: "Allergy",
      fulfillmentType: "DELIVERY",
      promisedAt: inMinutes(90),
      items: [{ sku: "GC-XL", quantity: 1 }],
    });
    expect(order.allergens).toEqual(["MILK", "SOY", "TREE_NUTS"]);
  });

  it("is idempotent on (store, source, externalId), including concurrent deliveries", async () => {
    const input = {
      source: "DEMO" as const,
      externalId: "ext-123",
      customerName: "Dup",
      fulfillmentType: "PICKUP" as const,
      promisedAt: inMinutes(30),
      items: [{ sku: "FC-3", quantity: 2 }],
    };
    const results = await Promise.all([createOrder(ctx.storeId, input), createOrder(ctx.storeId, input), createOrder(ctx.storeId, input)]);
    expect(new Set(results.map((r) => r.order.id)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
  });

  it("rejects unknown SKUs without writing anything", async () => {
    const before = (await getDb().select().from(orders)).length;
    await expectError(
      createOrder(ctx.storeId, { customerName: "X", fulfillmentType: "PICKUP", promisedAt: inMinutes(10), items: [{ sku: "NOPE", quantity: 1 }] }),
      "INVALID",
    );
    expect((await getDb().select().from(orders)).length).toBe(before);
  });
});

describe("task state machine + DAG progression", () => {
  it("unblocks a join only after all parents complete, then sends the item to QC", async () => {
    const { order } = await bouquet();
    await run(order.id, "melon");
    expect((await taskByKey(order.id, "assemble")).status).toBe("BLOCKED");
    await run(order.id, "pineapple");
    expect((await taskByKey(order.id, "assemble")).status).toBe("READY");
    const [o1] = await getDb().select().from(orders).where(eq(orders.id, order.id));
    expect(o1!.status).toBe("IN_PRODUCTION");
    await run(order.id, "assemble");
    await run(order.id, "package");
    const [item] = await getDb().select().from(orderItems).where(eq(orderItems.orderId, order.id));
    expect(item!.status).toBe("QC_PENDING");
    const [o2] = await getDb().select().from(orders).where(eq(orders.id, order.id));
    expect(o2!.status).toBe("QC");
  });

  it("rejects illegal transitions and stale versions", async () => {
    const { order } = await bouquet();
    const blocked = await taskByKey(order.id, "assemble");
    await expectError(transitionTask(ctx.storeId, blocked.id, "start", ctx.associate), "CONFLICT");
    const melon = await taskByKey(order.id, "melon");
    await expectError(transitionTask(ctx.storeId, melon.id, "complete", ctx.associate), "CONFLICT");
    await transitionTask(ctx.storeId, melon.id, "claim", ctx.associate, { expectedVersion: melon.version });
    await expectError(transitionTask(ctx.storeId, melon.id, "start", ctx.associate, { expectedVersion: melon.version }), "CONFLICT");
  });

  it("lets exactly one of two concurrent claims win", async () => {
    const { order } = await bouquet();
    const t = await taskByKey(order.id, "melon");
    const results = await Promise.allSettled([
      transitionTask(ctx.storeId, t.id, "claim", ctx.associate),
      transitionTask(ctx.storeId, t.id, "claim", ctx.associate2),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("stops another associate from working a claimed task, but lets a manager", async () => {
    const { order } = await bouquet();
    const t = await taskByKey(order.id, "melon");
    await transitionTask(ctx.storeId, t.id, "claim", ctx.associate);
    await expectError(transitionTask(ctx.storeId, t.id, "start", ctx.associate2), "FORBIDDEN");
    await transitionTask(ctx.storeId, t.id, "start", ctx.manager);
  });

  it("supports hold and resume", async () => {
    const { order } = await bouquet();
    const t = await taskByKey(order.id, "melon");
    await transitionTask(ctx.storeId, t.id, "start", ctx.associate);
    const held = await transitionTask(ctx.storeId, t.id, "hold", ctx.associate, { reason: "Out of melons" });
    expect(held.status).toBe("ON_HOLD");
    expect(held.holdReason).toBe("Out of melons");
    const resumed = await transitionTask(ctx.storeId, t.id, "resume", ctx.associate);
    expect(resumed.status).toBe("IN_PROGRESS");
  });
});

describe("QC, rework, staging and handoff", () => {
  it("runs fail -> rework -> pass -> stage -> handoff", async () => {
    const { order } = await createOrder(ctx.storeId, {
      customerName: "Full",
      fulfillmentType: "DELIVERY",
      promisedAt: inMinutes(45),
      items: [{ sku: "FC-3", quantity: 1 }],
    });
    await run(order.id, "cut");
    await run(order.id, "cup");
    const q = await getQcQueue(ctx.storeId);
    const entry = q.items.find((i) => i.order.id === order.id)!;
    expect(entry).toBeTruthy();

    await expectError(inspectItem(ctx.storeId, entry.item.id, { result: "FAIL" }, ctx.qc.id), "INVALID");
    await inspectItem(ctx.storeId, entry.item.id, { result: "FAIL", defectCodes: ["BRUISED_FRUIT"] }, ctx.qc.id);
    const rework = (await tasksFor(order.id)).find((t) => t.isRework)!;
    expect(rework.status).toBe("READY");
    expect(rework.stationId).toBe(ctx.stations.ASSEMBLY);
    // Can't inspect again while in rework.
    await expectError(inspectItem(ctx.storeId, entry.item.id, { result: "PASS" }, ctx.qc.id), "CONFLICT");
    await run(order.id, rework.stepKey);

    await inspectItem(ctx.storeId, entry.item.id, { result: "PASS" }, ctx.qc.id);
    let [o] = await getDb().select().from(orders).where(eq(orders.id, order.id));
    expect(o!.status).toBe("READY");
    expect((await getExpoQueue(ctx.storeId)).orders.some((x) => x.id === order.id)).toBe(true);

    await stageOrder(ctx.storeId, order.id, { location: "Shelf B2", packageCount: 1 }, ctx.qc.id);
    await handoffOrder(ctx.storeId, order.id, ctx.qc.id);
    [o] = await getDb().select().from(orders).where(eq(orders.id, order.id));
    expect(o!.status).toBe("COMPLETED");

    const detail = await getOrderDetail(ctx.storeId, order.id);
    const types = detail.events.map((e) => e.event.type);
    expect(types).toEqual(expect.arrayContaining(["ORDER_CREATED", "QC_FAILED", "QC_PASSED", "ORDER_READY", "ORDER_STAGED", "ORDER_HANDED_OFF"]));
    await expectError(handoffOrder(ctx.storeId, order.id, ctx.qc.id), "CONFLICT");
  });

  it("refuses to stage an order that isn't ready", async () => {
    const { order } = await bouquet();
    await expectError(stageOrder(ctx.storeId, order.id, { location: "A1", packageCount: 1 }, ctx.qc.id), "CONFLICT");
  });
});

describe("cancellation", () => {
  it("cancels open tasks and removes them from station queues", async () => {
    const { order } = await bouquet();
    await cancelOrder(ctx.storeId, order.id, ctx.manager.id, "Customer called");
    const ts = await tasksFor(order.id);
    expect(ts.every((t) => t.status === "CANCELLED")).toBe(true);
    const fruit = await getStationQueue(ctx.storeId, ctx.stations.FRUIT!);
    expect(fruit.tasks.some((t) => t.order.id === order.id)).toBe(false);
    await expectError(cancelOrder(ctx.storeId, order.id, ctx.manager.id), "CONFLICT");
  });
});

describe("outbox events", () => {
  it("records events in sequence for replay", async () => {
    const before = await readOutbox(0, 10_000);
    const last = before.at(-1)?.seq ?? 0;
    const { order } = await bouquet();
    const after = await readOutbox(last, 100, ctx.storeId);
    expect(after[0]).toMatchObject({ type: "ORDER_CREATED", payload: { orderId: order.id } });
    const seqs = after.map((e) => e.seq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
  });
});

describe("demo webhook adapter", () => {
  const body = (eventId: string, externalId: string) =>
    JSON.stringify({
      eventId,
      order: {
        externalId,
        customerName: "Webhook",
        fulfillmentType: "DELIVERY",
        promisedAt: inMinutes(60).toISOString(),
        items: [{ sku: "DB-12", quantity: 1 }],
      },
    });
  const sign = (raw: string, ts = String(Date.now())) => ({
    timestamp: ts,
    signature: signDemoPayload(process.env.DEMO_ADAPTER_SECRET!, ts, raw),
  });

  it("accepts a signed delivery and dedupes retries", async () => {
    const raw = body("evt-1", "ord-1");
    const first = await ingestDemoWebhook(raw, sign(raw));
    expect(first.duplicate).toBe(false);
    const again = await ingestDemoWebhook(raw, sign(raw));
    expect(again).toMatchObject({ orderId: first.orderId, duplicate: true });
  });

  it("rejects bad signatures and stale timestamps", async () => {
    const raw = body("evt-2", "ord-2");
    await expectError(ingestDemoWebhook(raw, { timestamp: String(Date.now()), signature: "00" }), "UNAUTHORIZED");
    await expectError(ingestDemoWebhook(raw, sign(raw, String(Date.now() - 60 * 60_000))), "UNAUTHORIZED");
    await expectError(ingestDemoWebhook(raw + " ", sign(raw)), "UNAUTHORIZED");
  });
});

describe("overview", () => {
  it("reports live counts", async () => {
    const o = await getOverview(ctx.storeId);
    expect(o.openOrders).toBeGreaterThan(0);
    expect(o.completed24h).toBeGreaterThanOrEqual(1);
    expect(o.qcInspections24h).toBeGreaterThanOrEqual(2);
    expect(o.stations).toHaveLength(4);
  });
});
