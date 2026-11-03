// `pnpm db:import-catalog`: adds the owner's perfume range (catalog-data.ts) that isn't in the
// database yet, with every size of catalog-prices.ts, always available (#66, #98), and the
// descriptions of catalog-descriptions.ts (#100). Products that exist only get a description where
// theirs is empty, so it's safe to re-run. Then run `pnpm db:sync-cms` to push the changes to Strapi.
import { existsSync } from "node:fs";
import { getDatabaseUrl } from "../../env";
import { CATALOG_PRODUCTS } from "../catalog-data";
import { CATALOG_DESCRIPTIONS } from "../catalog-descriptions";
import { CATALOG_PRICES } from "../catalog-prices";
import { createDb } from "../client";
import { importCatalog } from "../import-catalog";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const url = getDatabaseUrl(process.env);
if (!url) {
  console.error("Set DATABASE_URL (or JASSMINDB_URI) to the database to import into.");
  process.exit(1);
}

const db = createDb(url, 1);
try {
  const { inserted, variantsInserted, descriptionsFilled, queued } = await importCatalog(
    db,
    CATALOG_PRODUCTS,
    CATALOG_PRICES,
    CATALOG_DESCRIPTIONS,
  );
  console.log(
    `Imported ${inserted} of ${CATALOG_PRODUCTS.length} perfumes with ${variantsInserted} sizes (the rest already existed).`,
  );
  console.log(`Filled the empty descriptions of ${descriptionsFilled} existing perfumes.`);
  if (queued > 0) {
    console.log(`Queued ${queued} products for Strapi: run \`pnpm db:sync-cms\` to push them.`);
  }
} finally {
  await db.$client.end();
}
