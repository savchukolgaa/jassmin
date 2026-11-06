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
import { db as defaultDb } from "../db";
import type { Db } from "../db/client";
import { pgErrorCode, UNIQUE_VIOLATION } from "../db/errors";
import {
  insertInventoryMovements,
  inventoryBalance,
  type NewInventoryMovement,
  variantsWithMovements,
} from "../db/queries/inventory";
import { findOrderSyncState } from "../db/queries/orders";
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
import { changeOrderStatus } from "./order-lifecycle";

type Failure<E extends CmsSyncError["error"]> = { ok: false } & Extract<CmsSyncError, { error: E }>;

export type CmsProductResult =
  | { ok: true; product: CmsProductState }
  | Failure<"unknown-product" | "slug-taken" | "receipt-not-positive" | "size-has-stock-history">;

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

/** The opening balances of newly inserted sizes that track stock (#130). */
function openingBalances(
  inserted: readonly { id: number; volumeMl: number }[],
  sizes: readonly VariantWrite[],
): NewInventoryMovement[] {
  return inserted.flatMap(({ id, volumeMl }) => {
    const size = sizes.find((s) => s.volumeMl === volumeMl);
    if (!size?.trackStock) return [];
    return [
      {
        variantId: id,
        reason: "opening_balance",
        quantityDelta: size.stockQuantity,
        stockAfter: size.stockQuantity,
        source: "cms",
      },
    ];
  });
}

/**
 * Applies a product edit from the Strapi admin:
 * - `create` inserts the product and its sizes; the answer carries the new `publicId`.
 * - `update` rewrites the fields and matches sizes by volume: a new volume is inserted, a
 *   missing one deleted (its cart lines go, order lines keep their size snapshot), and an
 *   existing one gets the new price, tracking and stock (`editedStock`).
 * - `delete` only archives (`active = false`): order history keeps the product's title.
 *
 * Every change to a tracked size's stock goes in the inventory ledger (#130): a stock edit as the
 * reason staff picked (`adjustment` or `receipt`, with the change actually applied), and a size
 * that starts tracking stock (new, or switched on) as an `opening_balance` that brings the ledger
 * to its stock. A receipt that adds no units (`receipt-not-positive`) and removing a size with
 * ledger rows (`size-has-stock-history`) are refused before anything is written.
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
        const inserted = await insertVariants(tx, productId, sizes);
        await insertInventoryMovements(tx, openingBalances(inserted, sizes));
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
          const edits = change.variants.map((variant) => {
            const current = byVolume.get(variant.volumeMl);
            return {
              variant,
              current,
              stockQuantity: current ? editedStock(current, variant) : variant.stock,
            };
          });

          // Refusals come first, so a refused edit writes nothing (#130).
          const badReceipt = edits.find(
            ({ variant, current, stockQuantity }) =>
              current?.trackStock === true &&
              variant.trackStock &&
              variant.stockReason === "receipt" &&
              stockQuantity <= current.stockQuantity,
          );
          if (badReceipt) {
            return {
              ok: false,
              error: "receipt-not-positive",
              volumeMl: badReceipt.variant.volumeMl,
            };
          }
          const kept = new Set<number>(change.variants.map((v) => v.volumeMl));
          const removed = existing.filter((v) => !kept.has(v.volumeMl));
          const withHistory = await variantsWithMovements(
            tx,
            removed.map((v) => v.id),
          );
          const keptHistory = removed.find((v) => withHistory.has(v.id));
          if (keptHistory) {
            return { ok: false, error: "size-has-stock-history", volumeMl: keptHistory.volumeMl };
          }

          const sizes: VariantWrite[] = [];
          const added: VariantWrite[] = [];
          const movements: NewInventoryMovement[] = [];
          for (const { variant, current, stockQuantity } of edits) {
            const size = {
              volumeMl: variant.volumeMl,
              price: variant.price,
              stockQuantity,
              trackStock: variant.trackStock,
            };
            sizes.push(size);
            if (!current) {
              added.push(size);
              continue;
            }
            await updateVariant(tx, current.id, {
              price: size.price,
              stockQuantity,
              trackStock: size.trackStock,
            });
            if (!size.trackStock) continue;
            if (current.trackStock) {
              movements.push({
                variantId: current.id,
                reason: variant.stockReason ?? "adjustment",
                quantityDelta: stockQuantity - current.stockQuantity,
                stockAfter: stockQuantity,
                source: "cms",
              });
            } else {
              // Tracking starts (again): the ledger catches up with the typed stock.
              movements.push({
                variantId: current.id,
                reason: "opening_balance",
                quantityDelta: stockQuantity - (await inventoryBalance(tx, current.id)),
                stockAfter: stockQuantity,
                source: "cms",
              });
            }
          }
          await deleteVariants(
            tx,
            removed.map((v) => v.id),
          );
          const inserted = await insertVariants(tx, productId, added);
          await insertInventoryMovements(tx, [...movements, ...openingBalances(inserted, added)]);
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
      | "cancel-reason-required"
      | "invalid-payment-transition"
      | "arrived-not-shipped"
    >;

/**
 * Applies a status or payment change made in the Strapi admin, under the order's row lock, with
 * `changeOrderStatus`: checks it against the lifecycle rules (`nextOrderState`; cancelling needs a
 * reason, #128), sets the due timestamps, records a status change in `order_status_history`
 * (`cms`), queues the customer's status emails (#138) and, when the order is cancelled or comes
 * back unclaimed, puts its units back in stock (logged in the inventory ledger, #130), all in one
 * transaction. The restocked products are queued for a push, so Strapi shows their new stock. A
 * refused change writes nothing.
 */
export async function applyCmsOrderChange(
  orderId: number,
  change: CmsOrderChange,
  db: Db = defaultDb,
  now: Date = new Date(),
): Promise<CmsOrderResult> {
  return db.transaction(async (tx): Promise<CmsOrderResult> => {
    const changed = await changeOrderStatus(tx, orderId, change, { source: "cms", now });
    if (!changed.ok) {
      return changed;
    }

    const state = await findOrderSyncState(tx, orderId);
    if (!state) {
      throw new Error(`Order ${orderId} vanished inside its transaction`);
    }
    return { ok: true, order: toCmsOrderState(state), emailsQueued: changed.emailsQueued };
  });
}

/**
 * Pushes the due `cms_outbox` rows to Strapi right after a commit (checkout, a card payment, a
 * restock). Never rejects; `pnpm db:sync-cms` retries what fails.
 */
export function pushToCms(db: Db = defaultDb): Promise<CmsSyncReport> {
  return deliverCmsSync({}, () => cmsSyncDeps(db, getEnv()));
}
