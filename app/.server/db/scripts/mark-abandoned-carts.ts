// `pnpm db:mark-abandoned-carts`: marks carts inactive for more than ABANDONED_CART_HOURS (default
// 24) as abandoned. Run it hourly from an external scheduler (cron).
import { existsSync } from "node:fs";
import { getDatabaseUrl } from "../../env";
import { markAbandonedCartsJob, parseAbandonedCartHours } from "../abandoned-carts";
import { createDb } from "../client";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const hours = parseAbandonedCartHours(process.env);
if (!hours.ok) {
  console.error(hours.error);
  process.exit(1);
}

const url = getDatabaseUrl(process.env);
if (!url) {
  console.error("Set DATABASE_URL (or JASSMINDB_URI) to the app database.");
  process.exit(1);
}

const db = createDb(url, 1);
try {
  const { message } = await markAbandonedCartsJob(db, hours.hours);
  console.log(message);
} finally {
  await db.$client.end();
}
