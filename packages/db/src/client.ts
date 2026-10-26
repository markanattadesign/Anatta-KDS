import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.ts";

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

const g = globalThis as unknown as { __kdsPool?: pg.Pool; __kdsDb?: Db };

/** Process-wide pool (survives Next.js dev hot reloads). */
export function getDb(): Db {
  if (!g.__kdsDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    g.__kdsPool = new pg.Pool({ connectionString: url, max: 10 });
    g.__kdsDb = drizzle(g.__kdsPool, { schema });
  }
  return g.__kdsDb;
}

export async function closeDb(): Promise<void> {
  await g.__kdsPool?.end();
  g.__kdsPool = undefined;
  g.__kdsDb = undefined;
}
