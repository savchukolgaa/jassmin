// `pnpm db:seed`: adds the sample products and sizes from seed-data.ts that don't exist yet.
import { existsSync } from "node:fs";
import { getDatabaseUrl } from "../../env";
import { createDb } from "../client";
import { seedProducts } from "../seed";
import { SAMPLE_PRODUCTS } from "../seed-data";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const url = getDatabaseUrl(process.env);
if (!url) {
  console.error("Set DATABASE_URL (or JASSMINDB_URI) to the database to seed.");
  process.exit(1);
}

const db = createDb(url, 1);
try {
  const { inserted, variantsInserted } = await seedProducts(db);
  const variantCount = SAMPLE_PRODUCTS.reduce((sum, p) => sum + p.variants.length, 0);
  console.log(
    `Seeded ${inserted} of ${SAMPLE_PRODUCTS.length} sample products and ${variantsInserted} of ${variantCount} sizes (the rest already existed).`,
  );
} finally {
  await db.$client.end();
}
