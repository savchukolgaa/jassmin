// `pnpm db:rollback`: rolls back the most recently applied migration.
import { existsSync } from "node:fs";
import { getDatabaseUrl } from "../../env";
import { createDb } from "../client";
import { rollbackLatest } from "../migrator";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const url = getDatabaseUrl(process.env);
if (!url) {
  console.error("Set DATABASE_URL (or JASSMINDB_URI) to the database to roll back.");
  process.exit(1);
}

const db = createDb(url, 1);
try {
  const tag = await rollbackLatest(db);
  console.log(tag ? `Rolled back ${tag}.` : "No applied migrations to roll back.");
} finally {
  await db.$client.end();
}
