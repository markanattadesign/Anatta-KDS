import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDb, getDb } from "./client.ts";
import { seed } from "./seedData.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, "../../../.env") });
const migrationsFolder = path.resolve(here, "../drizzle");

async function main() {
  const cmd = process.argv[2];
  const db = getDb();
  if (cmd === "migrate" || cmd === "reset") {
    if (cmd === "reset") {
      await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;`);
      console.log("dropped schema");
    }
    await migrate(db, { migrationsFolder });
    console.log("migrations applied");
  }
  if (cmd === "seed" || cmd === "reset") {
    const r = await seed(db);
    console.log(r.created ? `seeded store ${r.storeId}` : `store ${r.storeId} already seeded, skipping`);
  }
  await closeDb();
}

main().catch(async (e) => {
  console.error(e);
  await closeDb();
  process.exit(1);
});
