// `pnpm db:cancel-unpaid-orders`: cancels card orders still unpaid UNPAID_ORDER_HOURS (default 48)
// after checkout, with the reason `payment_failed` (#128), and queues them for Strapi
// (`pnpm db:sync-cms` pushes them). Run it hourly from an external scheduler (cron).
import { existsSync } from "node:fs";
import { getDatabaseUrl } from "../../env";
import { cancelUnpaidOrders, parseUnpaidOrderHours } from "../cancel-unpaid-orders";
import { createDb } from "../client";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const hours = parseUnpaidOrderHours(process.env);
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
  const { message } = await cancelUnpaidOrders(db, { hours: hours.hours });
  console.log(message);
} finally {
  await db.$client.end();
}
