// `pnpm db:backfill-product-images` (#88): stores the size and resized formats of every
// product's Strapi image, for products synced before #88. Run it once after deploying #88; it is
// safe to run again. It needs the database, `STRAPI_URL` and `STRAPI_SYNC_TOKEN`.
import { existsSync } from "node:fs";
import { type CmsSyncEnv, getDatabaseUrl, parseCmsSyncEnv } from "../../env";
import {
  backfillProductImages,
  productImageBackfillDeps,
} from "../../services/product-image-backfill";
import { createDb } from "../client";

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
  const report = await backfillProductImages(productImageBackfillDeps(db, env));
  console.log(
    `Updated ${report.updated} product image(s); skipped ${report.skipped} Strapi product(s) without a match.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await db.$client.end();
}
