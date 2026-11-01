// A product's former URL slugs (#83), so old `/products/<slug>` links redirect to the current one.
import { eq, sql } from "drizzle-orm";
import type { Db } from "../index";
import { productSlugHistory } from "../schema";

type Executor = Pick<Db, "select" | "insert" | "delete">;

/**
 * Remembers `slug` as a former slug of the product. A slug another product once had moves to
 * this one, with a new `created_at`.
 */
export async function recordOldSlug(db: Executor, productId: number, slug: string): Promise<void> {
  await db
    .insert(productSlugHistory)
    .values({ productId, slug })
    .onConflictDoUpdate({
      target: productSlugHistory.slug,
      set: { productId, createdAt: sql`now()` },
    });
}

/** Forgets `slug` as anyone's former slug, because a product takes it as its current one. */
export async function forgetSlug(db: Executor, slug: string): Promise<void> {
  await db.delete(productSlugHistory).where(eq(productSlugHistory.slug, slug));
}

/** The serial id of the product that used to have `slug`, if any. */
export async function findProductIdBySlugHistory(
  db: Pick<Db, "select">,
  slug: string,
): Promise<number | undefined> {
  const [row] = await db
    .select({ productId: productSlugHistory.productId })
    .from(productSlugHistory)
    .where(eq(productSlugHistory.slug, slug))
    .limit(1);
  return row?.productId;
}
