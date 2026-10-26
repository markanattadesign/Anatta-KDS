import { and, asc, eq, gt, sql } from "drizzle-orm";
import type { KdsEvent, KdsEventType } from "@kds/contracts";
import { getDb, orderEvents, outbox, type Tx } from "@kds/db";

/** Single advisory-lock key serialising outbox writers (see emit()). */
const OUTBOX_LOCK = 724_001;

/**
 * Writes an event to the transactional outbox. Taking a transaction-scoped
 * advisory lock first means outbox sequence numbers are handed out in commit
 * order, so a reader polling `seq > last` can never skip a row that commits late.
 */
export async function emit(
  tx: Tx,
  storeId: string,
  type: KdsEventType,
  payload: Record<string, unknown>,
): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${OUTBOX_LOCK})`);
  await tx.insert(outbox).values({ storeId, type, payload });
}

/** Appends to the per-order audit trail. */
export async function audit(
  tx: Tx,
  orderId: string,
  type: string,
  actorId: string | null,
  data: Record<string, unknown> = {},
): Promise<void> {
  await tx.insert(orderEvents).values({ orderId, type, actorId, data });
}

function toEvent(r: typeof outbox.$inferSelect): KdsEvent {
  return {
    seq: r.seq,
    storeId: r.storeId,
    type: r.type as KdsEventType,
    payload: r.payload,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function readOutbox(afterSeq: number, limit = 500, storeId?: string): Promise<KdsEvent[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(outbox)
    .where(storeId ? and(gt(outbox.seq, afterSeq), eq(outbox.storeId, storeId)) : gt(outbox.seq, afterSeq))
    .orderBy(asc(outbox.seq))
    .limit(limit);
  return rows.map(toEvent);
}

export async function latestOutboxSeq(): Promise<number> {
  const db = getDb();
  const [r] = await db.select({ max: sql<string | null>`max(${outbox.seq})` }).from(outbox);
  return Number(r?.max ?? 0);
}
