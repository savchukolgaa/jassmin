import { and, eq, gt, inArray, ne, notInArray, sql } from "drizzle-orm";
import type { PerfumeVolumeMl } from "~/lib/enums";
import type { CatalogPrices } from "./catalog-prices";
import type { Db } from "./client";
import { enqueueCmsSync } from "./queries/cms-outbox";
import { products, productVariants } from "./schema";

export interface CatalogPricesResult {
  /** Sets (`pack_size > 1`) archived, so the tester trio stays the cheapest way to buy three. */
  setsArchived: number;
  /** Active products that got a missing size, a new price, a removed size or new legacy columns. */
  productsChanged: number;
  variantsInserted: number;
  pricesUpdated: number;
  variantsDeleted: number;
  /** Products queued for the Strapi push (`pnpm db:sync-cms`). */
  queued: number;
}

/**
 * Puts every active perfume on the shop's standard sizes and prices (#98), in one transaction:
 *
 * 1. archives every active set (`pack_size > 1`): at the standard prices a set would cost what one
 *    bottle does and undercut the tester trio;
 * 2. gives every active product each size of `prices` it lacks, untracked (always available);
 * 3. sets every size's price to the table;
 * 4. deletes sizes outside the table (their cart lines cascade, order lines keep their snapshot);
 * 5. sets the deprecated `products.price` / `volume_ml` / `stock_quantity` from the smallest size,
 *    as `productWrite` does;
 *
 * and queues the products it changed for Strapi. Every write is skipped when there's nothing to
 * change, so a second run changes nothing (and doesn't move `updated_at`). It never touches
 * `track_stock`, archived products or order history. It is a one-off fix, not a sync: running it
 * again resets prices staff changed in Strapi since.
 */
export async function applyCatalogPrices(
  db: Db,
  prices: CatalogPrices,
): Promise<CatalogPricesResult> {
  const sizes = Object.entries(prices)
    .map(([volume, price]) => ({ volumeMl: Number(volume) as PerfumeVolumeMl, price }))
    .filter((size): size is { volumeMl: PerfumeVolumeMl; price: string } => Boolean(size.price))
    .sort((a, b) => a.volumeMl - b.volumeMl);
  const [smallest] = sizes;
  if (!smallest) {
    throw new Error("The catalog price table has no sizes");
  }
  const volumes = sizes.map((size) => size.volumeMl);

  return db.transaction(async (tx) => {
    const archived = await tx
      .update(products)
      .set({ active: false })
      .where(and(eq(products.active, true), gt(products.packSize, 1)))
      .returning({ id: products.id });

    const active = await tx
      .select({ id: products.id })
      .from(products)
      .where(eq(products.active, true));
    const ids = active.map((row) => row.id);
    if (ids.length === 0) {
      const queued = archived.map((row) => row.id);
      await enqueueCmsSync(tx, "product", queued);
      return {
        setsArchived: archived.length,
        productsChanged: 0,
        variantsInserted: 0,
        pricesUpdated: 0,
        variantsDeleted: 0,
        queued: queued.length,
      };
    }

    const inserted = await tx
      .insert(productVariants)
      .values(
        ids.flatMap((productId) =>
          sizes.map((size) => ({ ...size, productId, stockQuantity: 0, trackStock: false })),
        ),
      )
      .onConflictDoNothing({ target: [productVariants.productId, productVariants.volumeMl] })
      .returning({ productId: productVariants.productId });

    const repriced: { productId: number }[] = [];
    for (const size of sizes) {
      repriced.push(
        ...(await tx
          .update(productVariants)
          .set({ price: size.price })
          .where(
            and(
              inArray(productVariants.productId, ids),
              eq(productVariants.volumeMl, size.volumeMl),
              ne(productVariants.price, size.price),
            ),
          )
          .returning({ productId: productVariants.productId })),
      );
    }

    const deleted = await tx
      .delete(productVariants)
      .where(
        and(inArray(productVariants.productId, ids), notInArray(productVariants.volumeMl, volumes)),
      )
      .returning({ productId: productVariants.productId });

    // Raw SQL, so `updated_at` is set by hand; only rows that differ are written.
    const legacy = await tx.execute<{ id: number }>(sql`
      update ${products} p
      set price = v.price, volume_ml = v.volume_ml, stock_quantity = v.stock_quantity,
          updated_at = now()
      from ${productVariants} v
      where v.product_id = p.id and v.volume_ml = ${smallest.volumeMl}
        and p.id in (${sql.join(
          ids.map((id) => sql`${id}`),
          sql`, `,
        )})
        and (p.price, p.volume_ml, p.stock_quantity)
          is distinct from (v.price, v.volume_ml, v.stock_quantity)
      returning p.id`);

    const changed = new Set([
      ...inserted.map((row) => row.productId),
      ...repriced.map((row) => row.productId),
      ...deleted.map((row) => row.productId),
      ...legacy.rows.map((row) => row.id),
    ]);
    const queued = [...new Set([...archived.map((row) => row.id), ...changed])];
    await enqueueCmsSync(tx, "product", queued);
    return {
      setsArchived: archived.length,
      productsChanged: changed.size,
      variantsInserted: inserted.length,
      pricesUpdated: repriced.length,
      variantsDeleted: deleted.length,
      queued: queued.length,
    };
  });
}
