// `pnpm db:expire-gift-cards`: marks active gift cards past their 12 months as expired (#125) and
// queues them for Strapi (`pnpm db:sync-cms` pushes them). Run it daily from an external
// scheduler (cron).
import { existsSync } from "node:fs";
import { getDatabaseUrl } from "../../env";
import { createDb } from "../client";
import { expireGiftCardsJob } from "../expire-gift-cards";

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
  const { message } = await expireGiftCardsJob(db);
  console.log(message);
} finally {
  await db.$client.end();
}
