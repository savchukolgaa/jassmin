// `pnpm db:create-databases <name> [<name> ...]`: creates the named databases on the app database's
// server when they're missing (#176). The production deployment's `db-migrate` runs it with
// `jassmindb strapidb` before the migrations, since Compose's Postgres starts empty.
import { existsSync } from "node:fs";
import { getDatabaseUrl } from "../../env";
import { createDatabases } from "../create-databases";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const url = getDatabaseUrl(process.env);
const names = process.argv.slice(2).filter((arg) => arg !== "--");
if (!url || names.length === 0) {
  console.error(
    "Usage: pnpm db:create-databases <name> [<name> ...], with DATABASE_URL (or JASSMINDB_URI) set.",
  );
  process.exit(1);
}

await createDatabases(url, names);
