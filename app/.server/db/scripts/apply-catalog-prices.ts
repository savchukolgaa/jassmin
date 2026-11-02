// `pnpm db:apply-catalog-prices`: puts every active perfume on the shop's standard sizes and prices
// (catalog-prices.ts, #98) and archives sets. A one-off fix: re-running it changes nothing unless
// staff changed sizes or prices in Strapi since, which it would reset. Then run `pnpm db:sync-cms`
// to push the changed products to Strapi.
import { existsSync } from "node:fs";
import { getDatabaseUrl } from "../../env";
import { applyCatalogPrices } from "../apply-catalog-prices";
import { CATALOG_PRICES } from "../catalog-prices";
import { createDb } from "../client";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const url = getDatabaseUrl(process.env);
if (!url) {
  console.error("Set DATABASE_URL (or JASSMINDB_URI) to the database to update.");
  process.exit(1);
}

const db = createDb(url, 1);
try {
  const result = await applyCatalogPrices(db, CATALOG_PRICES);
  console.log(
    `Archived ${result.setsArchived} sets. Updated ${result.productsChanged} perfumes: ` +
      `${result.variantsInserted} sizes added, ${result.pricesUpdated} prices changed, ` +
      `${result.variantsDeleted} sizes removed.`,
  );
  if (result.queued > 0) {
    console.log(
      `Queued ${result.queued} products for Strapi: run \`pnpm db:sync-cms\` to push them.`,
    );
  }
} finally {
  await db.$client.end();
}
