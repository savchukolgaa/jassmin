import type { PerfumeVolumeMl } from "~/lib/enums";
import type { CatalogEntry } from "./catalog/parse";
import type { CatalogPrices } from "./catalog-prices";
import type { Db } from "./client";
import { enqueueCmsSync } from "./queries/cms-outbox";
import { products, productVariants } from "./schema";

export interface CatalogImportResult {
  /** Perfumes added by this run. */
  inserted: number;
  variantsInserted: number;
  /** Products queued for the Strapi push (`pnpm db:sync-cms`). */
  queued: number;
}

/**
 * Loads the owner's perfume range (#66) in one transaction: inserts each entry that isn't in the
 * database yet (matched by `public_id`) with every size of the price table at stock 0, and queues
 * the new products for Strapi. New products get the owner's popular position (#67). A product
 * that exists is never touched, so whatever staff changed in Strapi (fields, prices, stock, sizes,
 * archiving, the popular position) survives a re-run, and running it twice adds nothing.
 */
export async function importCatalog(
  db: Db,
  entries: readonly CatalogEntry[],
  prices: CatalogPrices,
): Promise<CatalogImportResult> {
  const sizes = Object.entries(prices)
    .map(([volume, price]) => ({ volumeMl: Number(volume) as PerfumeVolumeMl, price }))
    .filter((size): size is { volumeMl: PerfumeVolumeMl; price: string } => Boolean(size.price))
    .sort((a, b) => a.volumeMl - b.volumeMl);
  const [smallest] = sizes;
  if (!smallest) {
    throw new Error("The catalog price table has no sizes");
  }
  if (entries.length === 0) {
    return { inserted: 0, variantsInserted: 0, queued: 0 };
  }

  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(products)
      .values(
        entries.map((entry) => ({
          publicId: entry.publicId,
          title: entry.title,
          brand: entry.brand,
          gender: entry.gender,
          // The ML column keeps the primary family; a CHECK holds it to the first one (#65).
          fragranceFamily: entry.fragranceFamilies[0] ?? null,
          fragranceFamilies: entry.fragranceFamilies,
          notes: entry.notes,
          storeCode: entry.storeCode,
          popularRank: entry.popularRank,
          // Deprecated columns (#26), filled from the smallest size like `productWrite`.
          price: smallest.price,
          volumeMl: smallest.volumeMl,
          stockQuantity: 0,
        })),
      )
      .onConflictDoNothing({ target: products.publicId })
      .returning({ id: products.id });
    const ids = inserted.map((row) => row.id);
    if (ids.length === 0) {
      return { inserted: 0, variantsInserted: 0, queued: 0 };
    }

    const variants = await tx
      .insert(productVariants)
      .values(
        ids.flatMap((productId) => sizes.map((size) => ({ ...size, productId, stockQuantity: 0 }))),
      )
      .onConflictDoNothing({ target: [productVariants.productId, productVariants.volumeMl] })
      .returning({ id: productVariants.id });

    await enqueueCmsSync(tx, "product", ids);
    return { inserted: ids.length, variantsInserted: variants.length, queued: ids.length };
  });
}
