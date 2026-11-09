// `pnpm analytics:export-catalog`: writes the real catalog and price table to
// analytics/generator/data/catalog.json for the synthetic data generator (#131). Run it after
// changing catalog-data.ts or catalog-prices.ts; `synthetic-catalog.test.ts` fails until you do.
import { writeFile } from "node:fs/promises";
import { renderSyntheticCatalog, SYNTHETIC_CATALOG_PATH } from "../synthetic-catalog";

await writeFile(SYNTHETIC_CATALOG_PATH, renderSyntheticCatalog(), "utf8");
console.log(`Wrote ${SYNTHETIC_CATALOG_PATH}.`);
