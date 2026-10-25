// Products and orders are managed in the Strapi admin (#40), but PostgreSQL stays the system of
// record: checkout locks and decrements stock here, and carts, order lines, offers and analytics
// point at these rows. Strapi's document middleware sends every staff edit to the `/cms/*`
// routes before Strapi saves it; the functions here apply it in one transaction and return the
// authoritative state for Strapi to store, or a typed error that Strapi shows to staff.
import type {
  CmsProductChange,
  CmsProductFields,
  CmsProductState,
  CmsSyncError,
} from "~/lib/cms-sync";
import { db as defaultDb } from "../db";
import type { Db } from "../db/client";
import { pgErrorCode, UNIQUE_VIOLATION } from "../db/errors";
import {
  deleteVariants,
  findProductSyncState,
  insertProduct,
  insertVariants,
  lockProductByPublicId,
  lockVariantsByProductId,
  type ProductSyncRow,
  type ProductWrite,
  updateProduct,
  updateVariant,
} from "../db/queries/products";

type Failure<E extends CmsSyncError["error"]> = { ok: false } & Extract<CmsSyncError, { error: E }>;

export type CmsProductResult =
  | { ok: true; product: CmsProductState }
  | Failure<"unknown-product" | "slug-taken">;

export function toCmsProductState(row: ProductSyncRow): CmsProductState {
  return {
    publicId: row.publicId,
    name: row.title,
    slug: row.slug,
    brand: row.brand,
    description: row.description,
    gender: row.gender,
    fragranceFamily: row.fragranceFamily,
    packSize: row.packSize,
    active: row.active,
    variants: row.variants,
  };
}

/** The product columns for Strapi's fields; the deprecated ones come from the smallest size. */
function productWrite(
  fields: CmsProductFields,
  sizes: readonly { volumeMl: number; price: string; stockQuantity: number }[],
): ProductWrite {
  const [main] = [...sizes].sort((a, b) => a.volumeMl - b.volumeMl);
  if (!main) {
    // The schema requires at least one size.
    throw new Error("A product needs at least one size");
  }
  return {
    title: fields.name,
    slug: fields.slug,
    brand: fields.brand,
    description: fields.description,
    gender: fields.gender,
    fragranceFamily: fields.fragranceFamily,
    imageUrl: fields.imageUrl,
    packSize: fields.packSize,
    active: fields.active,
    price: main.price,
    volumeMl: main.volumeMl,
    stockQuantity: main.stockQuantity,
  };
}

/**
 * Applies a product edit from the Strapi admin:
 * - `create` inserts the product and its sizes; the answer carries the new `publicId`.
 * - `update` rewrites the fields and matches sizes by volume: a new volume is inserted, a
 *   missing one deleted (its cart lines go, order lines keep their size snapshot), and an
 *   existing one gets the new price and its stock changed by `stock - expectedStock`, so units
 *   sold while staff had the form open stay sold. Stock never goes below 0.
 * - `delete` only archives (`active = false`): order history keeps the product's title.
 */
export async function applyCmsProductChange(
  change: CmsProductChange,
  db: Db = defaultDb,
): Promise<CmsProductResult> {
  try {
    return await db.transaction(async (tx): Promise<CmsProductResult> => {
      let productId: number;
      if (change.action === "create") {
        const sizes = change.variants.map((v) => ({
          volumeMl: v.volumeMl,
          price: v.price,
          stockQuantity: v.stock,
        }));
        ({ id: productId } = await insertProduct(tx, productWrite(change, sizes)));
        await insertVariants(tx, productId, sizes);
      } else {
        const id = await lockProductByPublicId(tx, change.publicId);
        if (id === undefined) {
          return { ok: false, error: "unknown-product" };
        }
        productId = id;
        if (change.action === "delete") {
          await updateProduct(tx, productId, { active: false });
        } else {
          const existing = await lockVariantsByProductId(tx, productId);
          const byVolume = new Map(existing.map((v) => [v.volumeMl, v]));
          const sizes: { volumeMl: number; price: string; stockQuantity: number }[] = [];
          const added: typeof sizes = [];
          for (const variant of change.variants) {
            const current = byVolume.get(variant.volumeMl);
            if (!current) {
              const size = {
                volumeMl: variant.volumeMl,
                price: variant.price,
                stockQuantity: variant.stock,
              };
              added.push(size);
              sizes.push(size);
              continue;
            }
            byVolume.delete(variant.volumeMl);
            const expected = variant.expectedStock ?? current.stockQuantity;
            const stockQuantity = Math.max(0, current.stockQuantity + variant.stock - expected);
            await updateVariant(tx, current.id, { price: variant.price, stockQuantity });
            sizes.push({ volumeMl: variant.volumeMl, price: variant.price, stockQuantity });
          }
          await deleteVariants(
            tx,
            [...byVolume.values()].map((v) => v.id),
          );
          await insertVariants(tx, productId, added);
          await updateProduct(tx, productId, productWrite(change, sizes));
        }
      }

      const state = await findProductSyncState(tx, productId);
      if (!state) {
        throw new Error(`Product ${productId} vanished inside its transaction`);
      }
      return { ok: true, product: toCmsProductState(state) };
    });
  } catch (error) {
    if (change.action !== "delete" && pgErrorCode(error) === UNIQUE_VIOLATION) {
      return { ok: false, error: "slug-taken", slug: change.slug };
    }
    throw error;
  }
}
