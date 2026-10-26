import { and, asc, desc, eq, sql } from "drizzle-orm";
import { CreateProductInputSchema, RecipeSchema, validateDag } from "@kds/contracts";
import { getDb, menuItems, recipes } from "@kds/db";
import { conflict, invalid, isUniqueViolation, notFound } from "./errors.ts";

export async function listProducts() {
  const db = getDb();
  const items = await db.select().from(menuItems).orderBy(asc(menuItems.name));
  const all = await db.select().from(recipes).orderBy(desc(recipes.version));
  return items.map((i) => {
    const rs = all.filter((r) => r.menuItemId === i.id);
    return {
      ...i,
      published: rs.find((r) => r.status === "PUBLISHED") ?? null,
      draft: rs.find((r) => r.status === "DRAFT") ?? null,
      versions: rs.length,
    };
  });
}

export async function getProduct(menuItemId: string) {
  const all = await listProducts();
  const p = all.find((x) => x.id === menuItemId);
  if (!p) throw notFound("Product");
  return p;
}

export async function createProduct(raw: unknown) {
  const parsed = CreateProductInputSchema.safeParse(raw);
  if (!parsed.success) throw invalid("Invalid product", parsed.error.flatten());
  try {
    const [row] = await getDb().insert(menuItems).values(parsed.data).returning();
    return row!;
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict(`SKU ${parsed.data.sku} already exists`);
    throw e;
  }
}

/** Creates or replaces the product's single DRAFT recipe after validating the step DAG. */
export async function saveDraftRecipe(menuItemId: string, raw: unknown) {
  const parsed = RecipeSchema.safeParse(raw);
  if (!parsed.success) throw invalid("Invalid recipe", parsed.error.flatten());
  const dag = validateDag(parsed.data.steps);
  if (!dag.ok) throw invalid(dag.errors.join("; "), { dag: dag.errors });

  return getDb().transaction(async (tx) => {
    const [item] = await tx.select().from(menuItems).where(eq(menuItems.id, menuItemId)).for("update");
    if (!item) throw notFound("Product");
    const [draft] = await tx
      .select()
      .from(recipes)
      .where(and(eq(recipes.menuItemId, menuItemId), eq(recipes.status, "DRAFT")));
    if (draft) {
      const [u] = await tx.update(recipes).set({ body: parsed.data }).where(eq(recipes.id, draft.id)).returning();
      return u!;
    }
    const [max] = await tx
      .select({ v: sql<number>`coalesce(max(${recipes.version}), 0)::int` })
      .from(recipes)
      .where(eq(recipes.menuItemId, menuItemId));
    const [r] = await tx
      .insert(recipes)
      .values({ menuItemId, version: (max?.v ?? 0) + 1, status: "DRAFT", body: parsed.data })
      .returning();
    return r!;
  });
}

/** Publishes the draft; the previously published version is archived. In-flight orders keep their snapshot. */
export async function publishRecipe(menuItemId: string) {
  return getDb().transaction(async (tx) => {
    const [draft] = await tx
      .select()
      .from(recipes)
      .where(and(eq(recipes.menuItemId, menuItemId), eq(recipes.status, "DRAFT")))
      .for("update");
    if (!draft) throw conflict("There is no draft to publish");
    await tx
      .update(recipes)
      .set({ status: "ARCHIVED" })
      .where(and(eq(recipes.menuItemId, menuItemId), eq(recipes.status, "PUBLISHED")));
    const [p] = await tx
      .update(recipes)
      .set({ status: "PUBLISHED", publishedAt: new Date() })
      .where(eq(recipes.id, draft.id))
      .returning();
    return p!;
  });
}
