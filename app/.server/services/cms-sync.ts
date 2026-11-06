// Products and orders are managed in the Strapi admin (#40), but PostgreSQL stays the system of
// record: checkout locks and decrements stock here, and carts, order lines, offers and analytics
// point at these rows. Strapi's document middleware sends every staff edit to the `/cms/*`
// routes before Strapi saves it; the functions here apply it in one transaction and return the
// authoritative state for Strapi to store, or a typed error that Strapi shows to staff.
import type {
  CmsOrderChange,
  CmsOrderState,
  CmsProductChange,
  CmsProductFields,
  CmsProductState,
  CmsSyncError,
  CmsVariantInput,
} from "~/lib/cms-sync";
import { nextOrderState } from "~/lib/order-status";
import { orderStatusEmailTypes } from "~/lib/order-status-emails";
import { db as defaultDb } from "../db";
import type { Db } from "../db/client";
import { pgErrorCode, UNIQUE_VIOLATION } from "../db/errors";
import { enqueueCmsSync } from "../db/queries/cms-outbox";
import { restoreGiftCardRedemptions } from "../db/queries/gift-cards";
import { queueOrderStatusEmails } from "../db/queries/order-emails";
import {
  findOrderSyncState,
  lockOrderLifecycle,
  restockOrder,
  updateOrderLifecycle,
} from "../db/queries/orders";
import { forgetSlug, recordOldSlug } from "../db/queries/product-slugs";
import {
  deleteVariants,
  findProductSyncState,
  insertProduct,
  insertVariants,
  lockProductByPublicId,
  lockVariantsByProductId,
  type ProductWrite,
  updateProduct,
  updateVariant,
  type VariantWrite,
} from "../db/queries/products";
import { getEnv } from "../env";
import {
  type CmsSyncReport,
  cmsSyncDeps,
  deliverCmsSync,
  toCmsOrderState,
  toCmsProductState,
} from "./cms-push";

type Failure<E extends CmsSyncError["error"]> = { ok: false } & Extract<CmsSyncError, { error: E }>;

export type CmsProductResult =
  | { ok: true; product: CmsProductState }
  | Failure<"unknown-product" | "slug-taken">;

/** The product columns for Strapi's fields; the deprecated ones come from the smallest size. */
function productWrite(fields: CmsProductFields, sizes: readonly VariantWrite[]): ProductWrite {
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
    descriptionEn: fields.descriptionEn,
    gender: fields.gender,
    // The ML column keeps the primary family; a CHECK holds it to the first one (#65).
    fragranceFamily: fields.fragranceFamilies[0] ?? null,
    fragranceFamilies: fields.fragranceFamilies,
    notes: fields.notes,
    storeCode: fields.storeCode,
    popularRank: fields.popularRank,
    imageUrl: fields.imageUrl,
    // Without an image, its size and formats describe nothing (#88).
    imageWidth: fields.imageUrl ? fields.imageWidth : null,
    imageHeight: fields.imageUrl ? fields.imageHeight : null,
    imageFormats: fields.imageUrl ? fields.imageFormats : null,
    packSize: fields.packSize,
    active: fields.active,
    price: main.price,
    volumeMl: main.volumeMl,
    stockQuantity: main.stockQuantity,
  };
}

/**
 * The stock a size gets from a staff edit. A size that tracks stock before and after the edit
 * changes by `stock - expectedStock`, so units sold while staff had the form open stay sold, and
 * never goes below 0. Otherwise nothing sold it in between (#98), so the typed stock is stored.
 */
function editedStock(
  current: { stockQuantity: number; trackStock: boolean },
  variant: CmsVariantInput,
): number {
  if (!(current.trackStock && variant.trackStock)) {
    return variant.stock;
  }
  const expected = variant.expectedStock ?? current.stockQuantity;
  return Math.max(0, current.stockQuantity + variant.stock - expected);
}

/**
 * Applies a product edit from the Strapi admin:
 * - `create` inserts the product and its sizes; the answer carries the new `publicId`.
 * - `update` rewrites the fields and matches sizes by volume: a new volume is inserted, a
 *   missing one deleted (its cart lines go, order lines keep their size snapshot), and an
 *   existing one gets the new price, tracking and stock (`editedStock`).
 * - `delete` only archives (`active = false`): order history keeps the product's title.
 *
 * A changed slug goes to `product_slug_history`, so `/products/<old slug>` redirects (#83), and
 * the slug a product takes is removed from it, so history never shadows a current slug.
 */
export async function applyCmsProductChange(
  change: CmsProductChange,
  db: Db = defaultDb,
): Promise<CmsProductResult> {
  try {
    return await db.transaction(async (tx): Promise<CmsProductResult> => {
      let productId: number;
      if (change.action === "create") {
        const sizes = change.variants.map(
          (v): VariantWrite => ({
            volumeMl: v.volumeMl,
            price: v.price,
            stockQuantity: v.stock,
            trackStock: v.trackStock,
          }),
        );
        ({ id: productId } = await insertProduct(tx, productWrite(change, sizes)));
        await insertVariants(tx, productId, sizes);
        await forgetSlug(tx, change.slug);
      } else {
        const locked = await lockProductByPublicId(tx, change.publicId);
        if (locked === undefined) {
          return { ok: false, error: "unknown-product" };
        }
        productId = locked.id;
        if (change.action === "delete") {
          await updateProduct(tx, productId, { active: false });
        } else {
          const existing = await lockVariantsByProductId(tx, productId);
          const byVolume = new Map(existing.map((v) => [v.volumeMl, v]));
          const sizes: VariantWrite[] = [];
          const added: VariantWrite[] = [];
          for (const variant of change.variants) {
            const current = byVolume.get(variant.volumeMl);
            const { trackStock } = variant;
            if (!current) {
              const size = {
                volumeMl: variant.volumeMl,
                price: variant.price,
                stockQuantity: variant.stock,
                trackStock,
              };
              added.push(size);
              sizes.push(size);
              continue;
            }
            byVolume.delete(variant.volumeMl);
            const stockQuantity = editedStock(current, variant);
            await updateVariant(tx, current.id, {
              price: variant.price,
              stockQuantity,
              trackStock,
            });
            sizes.push({
              volumeMl: variant.volumeMl,
              price: variant.price,
              stockQuantity,
              trackStock,
            });
          }
          await deleteVariants(
            tx,
            [...byVolume.values()].map((v) => v.id),
          );
          await insertVariants(tx, productId, added);
          await updateProduct(tx, productId, productWrite(change, sizes));
          // The old URL keeps working with a 301 to the new one (#83).
          if (locked.slug !== null && locked.slug !== change.slug) {
            await recordOldSlug(tx, productId, locked.slug);
          }
          await forgetSlug(tx, change.slug);
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

export type CmsOrderResult =
  /** `emailsQueued`: order status emails (#138) to send after the commit. */
  | { ok: true; order: CmsOrderState; emailsQueued: boolean }
  | Failure<
      | "unknown-order"
      | "invalid-transition"
      | "card-not-paid"
      | "invalid-payment-transition"
      | "arrived-not-shipped"
    >;

/**
 * Applies a status or payment change made in the Strapi admin, under the order's row lock:
 * checks it against the lifecycle rules (`nextOrderState`), sets the due timestamps and, when
 * the order is cancelled or comes back unclaimed, puts its units back in stock, all in one
 * transaction. The restocked products are queued for a push, so Strapi shows their new stock.
 * A refused change writes nothing.
 */
export async function applyCmsOrderChange(
  orderId: number,
  change: CmsOrderChange,
  db: Db = defaultDb,
  now: Date = new Date(),
): Promise<CmsOrderResult> {
  return db.transaction(async (tx): Promise<CmsOrderResult> => {
    const current = await lockOrderLifecycle(tx, orderId);
    if (!current) {
      return { ok: false, error: "unknown-order" };
    }
    const next = nextOrderState(current, change, now);
    if (!next.ok) {
      return next;
    }
    await updateOrderLifecycle(tx, orderId, next.patch);
    // The customer hears about it once per type, in the same transaction (#138).
    const emailsQueued = await queueOrderStatusEmails(
      tx,
      orderId,
      orderStatusEmailTypes(next.patch),
    );
    if (next.restock) {
      await enqueueCmsSync(tx, "product", await restockOrder(tx, orderId));
      // What a gift card paid goes back on it, like the units go back in stock (#125).
      await enqueueCmsSync(tx, "gift_card", await restoreGiftCardRedemptions(tx, orderId, now));
    }

    const state = await findOrderSyncState(tx, orderId);
    if (!state) {
      throw new Error(`Order ${orderId} vanished inside its transaction`);
    }
    return { ok: true, order: toCmsOrderState(state), emailsQueued: emailsQueued.length > 0 };
  });
}

/**
 * Pushes the due `cms_outbox` rows to Strapi right after a commit (checkout, a card payment, a
 * restock). Never rejects; `pnpm db:sync-cms` retries what fails.
 */
export function pushToCms(db: Db = defaultDb): Promise<CmsSyncReport> {
  return deliverCmsSync({}, () => cmsSyncDeps(db, getEnv()));
}
