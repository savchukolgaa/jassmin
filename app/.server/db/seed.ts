import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { Db } from "./client";
import { discounts, products, productVariants } from "./schema";
import { SAMPLE_DISCOUNTS, type SampleProduct, SEED_PRODUCTS } from "./seed-data";

/**
 * Inserts the `catalog`'s products and variants (by default `SEED_PRODUCTS`) that don't exist yet (matched by `publicId`, and by
 * `(product, volume)` for variants). Existing rows are not changed, except that products seeded
 * before #65 get their families and notes while their notes are still empty, and sample products
 * get their store code while it is empty (#67), so the seed is safe to run repeatedly. Popular
 * positions (#67) are only seeded while no product has one, so a re-seed never changes the list
 * staff keep in Strapi. It also adds new sample sizes to products seeded before #26. Returns how
 * many products and variants were added.
 */
export async function seedProducts(
  db: Db,
  catalog: readonly SampleProduct[] = SEED_PRODUCTS,
): Promise<{ inserted: number; variantsInserted: number }> {
  return db.transaction(async (tx) => {
    const ranked = await tx
      .select({ id: products.id })
      .from(products)
      .where(isNotNull(products.popularRank))
      .limit(1);
    const seedRanks = ranked.length === 0;

    const inserted = await tx
      .insert(products)
      .values(
        catalog.map(({ variants: _, ...product }) => ({
          ...product,
          fragranceFamily: product.fragranceFamilies[0] ?? null,
          popularRank: seedRanks ? (product.popularRank ?? null) : null,
        })),
      )
      .onConflictDoNothing({ target: products.publicId })
      .returning({ id: products.id });

    for (const product of catalog) {
      if (!product.notes?.length) continue;
      await tx
        .update(products)
        .set({
          fragranceFamilies: product.fragranceFamilies,
          fragranceFamily: product.fragranceFamilies[0] ?? null,
          notes: product.notes,
        })
        .where(and(eq(products.publicId, product.publicId), sql`${products.notes} = '{}'`));
    }

    for (const product of catalog) {
      if (product.storeCode) {
        await tx
          .update(products)
          .set({ storeCode: product.storeCode })
          .where(and(eq(products.publicId, product.publicId), isNull(products.storeCode)));
      }
      if (seedRanks && product.popularRank) {
        await tx
          .update(products)
          .set({ popularRank: product.popularRank })
          .where(eq(products.publicId, product.publicId));
      }
    }

    const rows = await tx
      .select({ id: products.id, publicId: products.publicId })
      .from(products)
      .where(
        inArray(
          products.publicId,
          catalog.map((p) => p.publicId),
        ),
      );
    const idByPublicId = new Map(rows.map((row) => [row.publicId, row.id]));
    const variants = catalog.flatMap((product) => {
      const productId = idByPublicId.get(product.publicId);
      return productId === undefined ? [] : product.variants.map((v) => ({ ...v, productId }));
    });
    const variantsInserted = await tx
      .insert(productVariants)
      .values(variants)
      .onConflictDoNothing({ target: [productVariants.productId, productVariants.volumeMl] })
      .returning({ id: productVariants.id });

    return { inserted: inserted.length, variantsInserted: variantsInserted.length };
  });
}

/**
 * Inserts the sample discount rules (#59) that don't exist yet, matched by `slug`. Existing rules
 * (and their redemption counts) are never changed. Returns how many were added.
 */
export async function seedDiscounts(db: Db): Promise<number> {
  const inserted = await db
    .insert(discounts)
    .values(SAMPLE_DISCOUNTS)
    .onConflictDoNothing({ target: discounts.slug })
    .returning({ id: discounts.id });
  return inserted.length;
}
