import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, "../../../.env") });
// Tests never touch the dev database.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://kds:kds@localhost:5432/kds_test";
process.env.DEMO_ADAPTER_SECRET ??= "test-secret";
