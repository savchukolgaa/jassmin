// `pnpm db:sync-cms`: pushes the queued order and product changes to Strapi (#40), retrying the
// ones that failed after checkout or a status change. Run it every 5 minutes from an external
// scheduler (cron). `--all` first queues every product and order: the first sync of an existing
// database (or of `pnpm db:seed`'s sample catalog) into a fresh Strapi.
// It needs the database, `STRAPI_URL` and `STRAPI_SYNC_TOKEN`, not the web app's variables.
import { existsSync } from "node:fs";
import { type CmsSyncEnv, getDatabaseUrl, parseCmsSyncEnv } from "../../env";
import { cmsSyncDeps, deliverCmsSync, describeCmsSyncReport } from "../../services/cms-push";
import { createDb } from "../client";
import { enqueueAllForCmsSync } from "../queries/cms-outbox";
import { backfillProductSlugs } from "../queries/products";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

let env: CmsSyncEnv;
try {
  env = parseCmsSyncEnv(process.env);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const url = getDatabaseUrl(process.env);
if (!url) {
  console.error("Set DATABASE_URL (or JASSMINDB_URI) to the app database.");
  process.exit(1);
}

const db = createDb(url, 1);
try {
  if (process.argv.includes("--all")) {
    await db.transaction(async (tx) => {
      await backfillProductSlugs(tx);
      await enqueueAllForCmsSync(tx);
    });
    console.log("Queued every product and order for Strapi.");
  }
  const report = await deliverCmsSync({}, cmsSyncDeps(db, env));
  console.log(describeCmsSyncReport(report));
  if (report.failed > 0) {
    process.exitCode = 1;
  }
} finally {
  await db.$client.end();
}
