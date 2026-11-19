// `pnpm db:build-recommendations`: rebuilds `product_recommendations` from the last year's orders
// and consented product views (#182). Products need RECS_MIN_SIGNALS (default 5) baskets. Run it
// nightly from an external scheduler (cron).
import { existsSync } from "node:fs";
import { getDatabaseUrl } from "../../env";
import { buildRecommendationsJob, parseMinSignals } from "../build-recommendations";
import { createDb } from "../client";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const parsed = parseMinSignals(process.env);
if (!parsed.ok) {
  console.error(parsed.error);
  process.exit(1);
}

const url = getDatabaseUrl(process.env);
if (!url) {
  console.error("Set DATABASE_URL (or JASSMINDB_URI) to the app database.");
  process.exit(1);
}

const db = createDb(url, 1);
try {
  const { message } = await buildRecommendationsJob(db, { minSignals: parsed.minSignals });
  console.log(message);
} finally {
  await db.$client.end();
}
