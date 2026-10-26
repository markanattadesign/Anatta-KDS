import bcrypt from "bcryptjs";
import {
  DEMO_PASSWORD,
  DEMO_PRODUCTS,
  DEMO_STATIONS,
  DEMO_STORE,
  DEMO_USERS,
  validateDag,
} from "@kds/contracts";
import type { Db } from "./client.ts";
import { memberships, menuItems, recipes, stations, stores, users } from "./schema.ts";

/** Seeds one store, four stations, the demo products and users. Idempotent: skips if a store exists. */
export async function seed(db: Db): Promise<{ storeId: string; created: boolean }> {
  const existing = await db.select({ id: stores.id }).from(stores).limit(1);
  if (existing[0]) return { storeId: existing[0].id, created: false };

  return db.transaction(async (tx) => {
    const [store] = await tx.insert(stores).values(DEMO_STORE).returning();
    await tx.insert(stations).values(
      DEMO_STATIONS.map((s, i) => ({ storeId: store!.id, name: s.name, kind: s.kind, sortOrder: i })),
    );
    const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
    for (const u of DEMO_USERS) {
      const [row] = await tx.insert(users).values({ email: u.email, name: u.name, passwordHash: hash }).returning();
      await tx.insert(memberships).values({ userId: row!.id, storeId: store!.id, role: u.role });
    }
    for (const p of DEMO_PRODUCTS) {
      const dag = validateDag(p.recipe.steps);
      if (!dag.ok) throw new Error(`Bad demo recipe ${p.sku}: ${dag.errors.join("; ")}`);
      const [item] = await tx.insert(menuItems).values({ sku: p.sku, name: p.name }).returning();
      await tx.insert(recipes).values({
        menuItemId: item!.id,
        version: 1,
        status: "PUBLISHED",
        body: p.recipe,
        publishedAt: new Date(),
      });
    }
    return { storeId: store!.id, created: true };
  });
}
