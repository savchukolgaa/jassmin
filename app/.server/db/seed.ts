import type { Db } from "./client";
import { products } from "./schema";
import { SAMPLE_PRODUCTS } from "./seed-data";

/**
 * Inserts the sample products that don't exist yet (matched by `publicId`). Existing rows are
 * never changed, so the seed is safe to run repeatedly. Returns how many products were added.
 */
export async function seedProducts(db: Db): Promise<{ inserted: number }> {
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(products)
      .values(SAMPLE_PRODUCTS)
      .onConflictDoNothing({ target: products.publicId })
      .returning({ id: products.id });
    return { inserted: inserted.length };
  });
}
