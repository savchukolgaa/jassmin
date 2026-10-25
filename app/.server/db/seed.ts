import { inArray } from "drizzle-orm";
import type { Db } from "./client";
import { discounts, products, productVariants } from "./schema";
import { SAMPLE_DISCOUNTS, SAMPLE_PRODUCTS } from "./seed-data";

/**
 * Inserts the sample products and variants that don't exist yet (matched by `publicId`, and by
 * `(product, volume)` for variants). Existing rows are never changed, so the seed is safe to run
 * repeatedly, and it adds new sample sizes to products seeded before #26. Returns how many
 * products and variants were added.
 */
export async function seedProducts(
  db: Db,
): Promise<{ inserted: number; variantsInserted: number }> {
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(products)
      .values(SAMPLE_PRODUCTS.map(({ variants: _, ...product }) => product))
      .onConflictDoNothing({ target: products.publicId })
      .returning({ id: products.id });

    const rows = await tx
      .select({ id: products.id, publicId: products.publicId })
      .from(products)
      .where(
        inArray(
          products.publicId,
          SAMPLE_PRODUCTS.map((p) => p.publicId),
        ),
      );
    const idByPublicId = new Map(rows.map((row) => [row.publicId, row.id]));
    const variants = SAMPLE_PRODUCTS.flatMap((product) => {
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
