import { createId } from "@paralleldrive/cuid2";
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import {
  FULFILLMENT_TYPES,
  ITEM_STATUSES,
  ORDER_SOURCES,
  ORDER_STATUSES,
  ROLES,
  STATION_KINDS,
  TASK_STATUSES,
  type Recipe,
  type RecipeStep,
} from "@kds/contracts";

const id = () => text("id").primaryKey().$defaultFn(() => createId());
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const roleEnum = pgEnum("role", ROLES);
export const stationKindEnum = pgEnum("station_kind", STATION_KINDS);
export const taskStatusEnum = pgEnum("task_status", TASK_STATUSES);
export const orderStatusEnum = pgEnum("order_status", ORDER_STATUSES);
export const itemStatusEnum = pgEnum("item_status", ITEM_STATUSES);
export const orderSourceEnum = pgEnum("order_source", ORDER_SOURCES);
export const fulfillmentEnum = pgEnum("fulfillment_type", FULFILLMENT_TYPES);
export const recipeStatusEnum = pgEnum("recipe_status", ["DRAFT", "PUBLISHED", "ARCHIVED"]);
export const qcResultEnum = pgEnum("qc_result", ["PASS", "FAIL"]);

export const stores = pgTable("stores", {
  id: id(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("America/Chicago"),
  orderSeq: integer("order_seq").notNull().default(1000),
  createdAt: createdAt(),
});

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

export const memberships = pgTable(
  "memberships",
  {
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    storeId: text("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.storeId] })],
);

export const stations = pgTable("stations", {
  id: id(),
  storeId: text("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kind: stationKindEnum("kind").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
});

/** Products are store-agnostic (one menu across the brand); recipes are versioned. */
export const menuItems = pgTable("menu_items", {
  id: id(),
  sku: text("sku").notNull().unique(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

export const recipes = pgTable(
  "recipes",
  {
    id: id(),
    menuItemId: text("menu_item_id").notNull().references(() => menuItems.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    status: recipeStatusEnum("status").notNull().default("DRAFT"),
    body: jsonb("body").$type<Recipe>().notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("recipes_item_version").on(t.menuItemId, t.version)],
);

export const orders = pgTable(
  "orders",
  {
    id: id(),
    storeId: text("store_id").notNull().references(() => stores.id),
    number: integer("number").notNull(),
    source: orderSourceEnum("source").notNull(),
    externalId: text("external_id"),
    customerName: text("customer_name").notNull(),
    fulfillmentType: fulfillmentEnum("fulfillment_type").notNull(),
    promisedAt: timestamp("promised_at", { withTimezone: true }).notNull(),
    status: orderStatusEnum("status").notNull().default("NEW"),
    notes: text("notes").notNull().default(""),
    allergens: text("allergens").array().notNull().default([]),
    stagingLocation: text("staging_location"),
    packageCount: integer("package_count"),
    readyAt: timestamp("ready_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("orders_store_source_external").on(t.storeId, t.source, t.externalId),
    uniqueIndex("orders_store_number").on(t.storeId, t.number),
    index("orders_store_status").on(t.storeId, t.status),
  ],
);

export const orderItems = pgTable("order_items", {
  id: id(),
  orderId: text("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  menuItemId: text("menu_item_id").notNull().references(() => menuItems.id),
  recipeId: text("recipe_id").notNull().references(() => recipes.id),
  name: text("name").notNull(),
  sku: text("sku").notNull(),
  quantity: integer("quantity").notNull(),
  notes: text("notes").notNull().default(""),
  /** Frozen copy of the recipe at order time, so later recipe edits never change in-flight work. */
  recipeSnapshot: jsonb("recipe_snapshot").$type<Recipe>().notNull(),
  status: itemStatusEnum("status").notNull().default("IN_PRODUCTION"),
  qcAttempts: integer("qc_attempts").notNull().default(0),
  version: integer("version").notNull().default(1),
});

export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    storeId: text("store_id").notNull().references(() => stores.id),
    orderId: text("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    orderItemId: text("order_item_id").notNull().references(() => orderItems.id, { onDelete: "cascade" }),
    stationId: text("station_id").notNull().references(() => stations.id),
    stepKey: text("step_key").notNull(),
    name: text("name").notNull(),
    instructions: text("instructions").notNull().default(""),
    durationSec: integer("duration_sec").notNull(),
    /** Step keys (within the same order item) that must be DONE first. */
    dependsOn: text("depends_on").array().notNull().default([]),
    status: taskStatusEnum("status").notNull(),
    isRework: boolean("is_rework").notNull().default(false),
    claimedBy: text("claimed_by").references(() => users.id),
    readyAt: timestamp("ready_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    holdReason: text("hold_reason"),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [
    index("tasks_station_status").on(t.stationId, t.status),
    index("tasks_item").on(t.orderItemId),
  ],
);

export const qcInspections = pgTable("qc_inspections", {
  id: id(),
  orderItemId: text("order_item_id").notNull().references(() => orderItems.id, { onDelete: "cascade" }),
  inspectorId: text("inspector_id").notNull().references(() => users.id),
  result: qcResultEnum("result").notNull(),
  checklist: jsonb("checklist").$type<Record<string, boolean>>().notNull().default({}),
  defectCodes: text("defect_codes").array().notNull().default([]),
  notes: text("notes").notNull().default(""),
  createdAt: createdAt(),
});

/** Append-only audit trail per order. */
export const orderEvents = pgTable(
  "order_events",
  {
    id: id(),
    orderId: text("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    actorId: text("actor_id").references(() => users.id),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("order_events_order").on(t.orderId, t.createdAt)],
);

/** Transactional outbox: rows become visible only when their transaction commits. */
export const outbox = pgTable(
  "outbox",
  {
    seq: bigserial("seq", { mode: "number" }).primaryKey(),
    storeId: text("store_id").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("outbox_store_seq").on(t.storeId, t.seq)],
);

/** Webhook delivery dedup per provider. */
export const inboxEvents = pgTable(
  "inbox_events",
  {
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    receivedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.provider, t.eventId] })],
);

export type RecipeStepRow = RecipeStep;
