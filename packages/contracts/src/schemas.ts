import { z } from "zod";

export const ROLES = ["ASSOCIATE", "QC", "MANAGER", "ADMIN"] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_RANK: Record<Role, number> = { ASSOCIATE: 1, QC: 2, MANAGER: 3, ADMIN: 4 };

export const STATION_KINDS = ["FRUIT", "CHOCOLATE", "ASSEMBLY", "PACKAGING"] as const;
export type StationKind = (typeof STATION_KINDS)[number];

export const TASK_STATUSES = [
  "BLOCKED",
  "READY",
  "CLAIMED",
  "IN_PROGRESS",
  "ON_HOLD",
  "DONE",
  "CANCELLED",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const ORDER_STATUSES = [
  "NEW",
  "IN_PRODUCTION",
  "QC",
  "READY",
  "STAGED",
  "COMPLETED",
  "CANCELLED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ITEM_STATUSES = ["IN_PRODUCTION", "QC_PENDING", "REWORK", "QC_PASSED", "CANCELLED"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const ORDER_SOURCES = ["MANUAL", "DEMO"] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];

export const FULFILLMENT_TYPES = ["PICKUP", "DELIVERY"] as const;
export type FulfillmentType = (typeof FULFILLMENT_TYPES)[number];

export const ALLERGENS = ["MILK", "SOY", "TREE_NUTS", "PEANUTS", "WHEAT", "EGG", "COCONUT"] as const;
export type Allergen = (typeof ALLERGENS)[number];

export const DEFECT_CODES = [
  "BRUISED_FRUIT",
  "CHOCOLATE_SMUDGE",
  "WRONG_COMPONENT",
  "MISSING_COMPONENT",
  "LOOSE_SKEWER",
  "DAMAGED_PACKAGING",
  "OTHER",
] as const;
export type DefectCode = (typeof DEFECT_CODES)[number];

/** Generic QC checklist shown on the QC board (fixed set, see README). */
export const QC_CHECKLIST = [
  { key: "matches_ticket", label: "Matches the ticket (product + size)" },
  { key: "fruit_quality", label: "Fruit fresh, firm, no bruising" },
  { key: "chocolate_finish", label: "Chocolate set, clean finish (if any)" },
  { key: "secure", label: "Skewers secure, container sealed" },
] as const;

export const RecipeStepSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9_-]+$/, "lowercase letters, digits, - or _"),
  name: z.string().min(1).max(80),
  stationKind: z.enum(STATION_KINDS),
  durationSec: z.number().int().min(10).max(3600),
  dependsOn: z.array(z.string()).default([]),
  instructions: z.string().max(500).default(""),
});
export type RecipeStep = z.infer<typeof RecipeStepSchema>;

export const RecipeSchema = z.object({
  steps: z.array(RecipeStepSchema).min(1).max(30),
  components: z.array(z.string().min(1).max(60)).default([]),
  allergens: z.array(z.enum(ALLERGENS)).default([]),
});
export type Recipe = z.infer<typeof RecipeSchema>;

export const CreateOrderInputSchema = z.object({
  source: z.enum(ORDER_SOURCES).default("MANUAL"),
  externalId: z.string().min(1).max(100).optional(),
  customerName: z.string().min(1).max(80),
  fulfillmentType: z.enum(FULFILLMENT_TYPES),
  promisedAt: z.coerce.date(),
  notes: z.string().max(500).default(""),
  items: z
    .array(
      z.object({
        sku: z.string().min(1).max(40),
        quantity: z.number().int().min(1).max(20),
        notes: z.string().max(200).default(""),
      }),
    )
    .min(1)
    .max(20),
});
export type CreateOrderInput = z.input<typeof CreateOrderInputSchema>;
export type CreateOrderParsed = z.output<typeof CreateOrderInputSchema>;

export const LoginInputSchema = z.object({
  email: z.string().email().max(120),
  password: z.string().min(1).max(200),
});

export const TASK_ACTIONS = ["claim", "unclaim", "start", "complete", "hold", "resume"] as const;
export type TaskAction = (typeof TASK_ACTIONS)[number];

export const TaskActionInputSchema = z.object({
  expectedVersion: z.number().int().optional(),
  reason: z.string().max(200).optional(),
});

export const QcInspectionInputSchema = z.object({
  result: z.enum(["PASS", "FAIL"]),
  checklist: z.record(z.boolean()).default({}),
  defectCodes: z.array(z.enum(DEFECT_CODES)).default([]),
  notes: z.string().max(300).default(""),
}).refine((v) => v.result === "PASS" || v.defectCodes.length > 0, {
  message: "At least one defect code is required on fail",
  path: ["defectCodes"],
});
export type QcInspectionInput = z.input<typeof QcInspectionInputSchema>;

export const StageInputSchema = z.object({
  location: z.string().min(1).max(40),
  packageCount: z.number().int().min(1).max(50),
});

export const CancelInputSchema = z.object({ reason: z.string().max(200).default("") });

export const CreateProductInputSchema = z.object({
  sku: z.string().min(1).max(40).regex(/^[A-Z0-9-]+$/, "uppercase letters, digits and -"),
  name: z.string().min(1).max(80),
});

/** Event types written to the outbox and streamed over SSE. */
export type KdsEventType =
  | "ORDER_CREATED"
  | "ORDER_UPDATED"
  | "ORDER_CANCELLED"
  | "TASK_UPDATED"
  | "QC_RESULT";

export interface KdsEvent {
  seq: number;
  storeId: string;
  type: KdsEventType;
  payload: Record<string, unknown>;
  createdAt: string;
}
