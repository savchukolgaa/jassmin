import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "./client";
import { insertInventoryMovements } from "./queries/inventory";
import { discounts, products, productVariants } from "./schema";
import { SAMPLE_DISCOUNTS, SAMPLE_PRODUCTS } from "./seed-data";

/**
 * Inserts the sample products and variants that don't exist yet (matched by `publicId`, and by
 * `(product, volume)` for variants). Existing rows are not changed, except that products seeded
 * before #65 get their families and notes while their notes are still empty, so the seed is safe to
 * run repeatedly. It also adds new sample sizes to products seeded before #26. Each new size's
 * stock is its opening balance in the inventory ledger (#130). Returns how many products and
 * variants were added.
 */
export async function seedProducts(
  db: Db,
): Promise<{ inserted: number; variantsInserted: number }> {
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(products)
      .values(
        SAMPLE_PRODUCTS.map(({ variants: _, ...product }) => ({
          ...product,
          fragranceFamily: product.fragranceFamilies[0] ?? null,
        })),
      )
      .onConflictDoNothing({ target: products.publicId })
      .returning({ id: products.id });

    for (const product of SAMPLE_PRODUCTS) {
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
      // The samples count their stock (#98), so local development and the tests keep sold-out and
      // low-stock sizes; the shop's own range (`db:import-catalog`) is untracked.
      return productId === undefined
        ? []
        : product.variants.map((v) => ({ ...v, productId, trackStock: true }));
    });
    const variantsInserted = await tx
      .insert(productVariants)
      .values(variants)
      .onConflictDoNothing({ target: [productVariants.productId, productVariants.volumeMl] })
      .returning({ id: productVariants.id, stockQuantity: productVariants.stockQuantity });
    // Their stock opens the inventory ledger (#130), so it adds up to the stock from the start.
    await insertInventoryMovements(
      tx,
      variantsInserted.map(({ id, stockQuantity }) => ({
        variantId: id,
        reason: "opening_balance",
        quantityDelta: stockQuantity,
        stockAfter: stockQuantity,
        source: "job",
      })),
    );

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
