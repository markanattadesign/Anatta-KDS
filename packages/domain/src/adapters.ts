import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { CreateOrderInputSchema } from "@kds/contracts";
import { getDb, inboxEvents, stores } from "@kds/db";
import { DomainError, invalid } from "./errors.ts";
import { createOrder } from "./orders.ts";

/**
 * Demo intake adapter: an HMAC-signed webhook standing in for a delivery
 * platform. Flow: verify signature + timestamp -> parse/normalise ->
 * dedupe by event id -> idempotent createOrder -> acknowledge.
 * Real platforms need their own signature scheme; copy the flow, not the crypto.
 */
export const DEMO_PROVIDER = "demo";
const MAX_SKEW_MS = 5 * 60 * 1000;

export const DemoWebhookSchema = z.object({
  eventId: z.string().min(1).max(100),
  order: CreateOrderInputSchema.omit({ source: true }).extend({ externalId: z.string().min(1).max(100) }),
});

export function signDemoPayload(secret: string, timestamp: string, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

export function verifyDemoSignature(
  secret: string,
  rawBody: string,
  timestamp: string | null,
  signature: string | null,
  now = Date.now(),
): boolean {
  if (!timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > MAX_SKEW_MS) return false;
  const expected = Buffer.from(signDemoPayload(secret, timestamp, rawBody), "hex");
  const given = Buffer.from(signature.replace(/^sha256=/, ""), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function ingestDemoWebhook(
  rawBody: string,
  headers: { timestamp: string | null; signature: string | null },
) {
  const secret = process.env.DEMO_ADAPTER_SECRET;
  if (!secret) throw new Error("DEMO_ADAPTER_SECRET is not set");
  if (!verifyDemoSignature(secret, rawBody, headers.timestamp, headers.signature)) {
    throw new DomainError("UNAUTHORIZED", "Bad or expired signature");
  }
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    throw invalid("Body is not JSON");
  }
  const parsed = DemoWebhookSchema.safeParse(json);
  if (!parsed.success) throw invalid("Invalid webhook payload", parsed.error.flatten());

  const db = getDb();
  const [seen] = await db
    .select()
    .from(inboxEvents)
    .where(and(eq(inboxEvents.provider, DEMO_PROVIDER), eq(inboxEvents.eventId, parsed.data.eventId)))
    .limit(1);
  // Single-store demo: route every demo order to the one store.
  const [store] = await db.select({ id: stores.id }).from(stores).limit(1);
  if (!store) throw new DomainError("NOT_FOUND", "No store configured");

  const { order, created } = await createOrder(store.id, { ...parsed.data.order, source: "DEMO" });
  if (!seen) {
    await db.insert(inboxEvents).values({ provider: DEMO_PROVIDER, eventId: parsed.data.eventId }).onConflictDoNothing();
  }
  return { orderId: order.id, number: order.number, duplicate: !created || !!seen };
}
