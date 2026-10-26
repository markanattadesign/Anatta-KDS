import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { DEMO_USERS, type Role } from "@kds/contracts";
import { getDb, memberships, seed, stations, tasks, users } from "@kds/db";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Fresh schema + seed for each test file. */
export async function resetDb() {
  const db = getDb();
  await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;`);
  await migrate(db, { migrationsFolder: path.resolve(here, "../../db/drizzle") });
  const { storeId } = await seed(db);
  const st = await db.select().from(stations).where(eq(stations.storeId, storeId));
  const byKind = Object.fromEntries(st.map((s) => [s.kind, s.id])) as Record<string, string>;
  const us = await db
    .select({ id: users.id, email: users.email, role: memberships.role })
    .from(users)
    .innerJoin(memberships, eq(memberships.userId, users.id));
  const actor = (email: (typeof DEMO_USERS)[number]["email"]) => {
    const u = us.find((x) => x.email === email)!;
    return { id: u.id, role: u.role as Role };
  };
  return {
    storeId,
    stations: byKind,
    associate: actor("associate1@ediblekds.demo"),
    associate2: actor("associate2@ediblekds.demo"),
    qc: actor("qc@ediblekds.demo"),
    manager: actor("manager@ediblekds.demo"),
  };
}

export async function tasksFor(orderId: string) {
  return getDb().select().from(tasks).where(eq(tasks.orderId, orderId));
}

export async function taskByKey(orderId: string, stepKey: string) {
  const [t] = await getDb()
    .select()
    .from(tasks)
    .where(and(eq(tasks.orderId, orderId), eq(tasks.stepKey, stepKey)));
  return t!;
}

export const inMinutes = (m: number) => new Date(Date.now() + m * 60_000);
