// `pnpm db:prune-rate-limits`: deletes ended rate-limit windows from `rate_limits` (#143). Run it
// daily from an external scheduler (cron).
import { existsSync } from "node:fs";
import { getDatabaseUrl } from "../../env";
import { createDb } from "../client";
import { pruneRateLimitsJob } from "../prune-rate-limits";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const url = getDatabaseUrl(process.env);
if (!url) {
  console.error("Set DATABASE_URL (or JASSMINDB_URI) to the app database.");
  process.exit(1);
}

const db = createDb(url, 1);
try {
  const { message } = await pruneRateLimitsJob(db);
  console.log(message);
} finally {
  await db.$client.end();
}
