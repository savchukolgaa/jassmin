// `pnpm db:seed`: adds the sample products from seed-data.ts that don't exist yet.
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
  const { inserted } = await seedProducts(db);
  console.log(
    `Seeded ${inserted} of ${SAMPLE_PRODUCTS.length} sample products (the rest already existed).`,
  );
} finally {
  await db.$client.end();
}
