// `pnpm db:make-admin <email> [--revoke]`: promotes a registered user to admin (or demotes them).
import { existsSync } from "node:fs";
import { getDatabaseUrl } from "../../env";
import { createDb } from "../client";
import { makeAdmin, parseMakeAdminArgs } from "../make-admin";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const args = parseMakeAdminArgs(process.argv.slice(2));
if (!args.ok) {
  console.error(args.error);
  process.exit(1);
}

const url = getDatabaseUrl(process.env);
if (!url) {
  console.error("Set DATABASE_URL (or JASSMINDB_URI) to the app database.");
  process.exit(1);
}

const db = createDb(url, 1);
try {
  const result = await makeAdmin(db, args);
  if (result.ok) {
    console.log(result.message);
  } else {
    console.error(result.message);
    process.exitCode = 1;
  }
} finally {
  await db.$client.end();
}
