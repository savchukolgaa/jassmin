// `pnpm db:prune-perfumer-chats`: deletes the AI perfumer's saved chats not updated for
// PERFUMER_CHAT_RETENTION_DAYS (default 90), with their messages (#180). Run it daily from an
// external scheduler (cron).
import { existsSync } from "node:fs";
import { getDatabaseUrl } from "../../env";
import { createDb } from "../client";
import { parsePerfumerChatRetentionDays, prunePerfumerChatsJob } from "../prune-perfumer-chats";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const days = parsePerfumerChatRetentionDays(process.env);
if (!days.ok) {
  console.error(days.error);
  process.exit(1);
}

const url = getDatabaseUrl(process.env);
if (!url) {
  console.error("Set DATABASE_URL (or JASSMINDB_URI) to the app database.");
  process.exit(1);
}

const db = createDb(url, 1);
try {
  const { message } = await prunePerfumerChatsJob(db, { days: days.days });
  console.log(message);
} finally {
  await db.$client.end();
}
