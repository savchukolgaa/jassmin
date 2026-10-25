// Pushes app changes to Strapi (#40): orders placed at checkout, paid by card or changed in the
// admin, and the stock of products sold or restocked. Changes are queued in `cms_outbox` inside
// the transaction that made them; this module claims due rows, upserts each entity's current
// state in Strapi with the `STRAPI_SYNC_TOKEN` and marks the row. The app tries right after a
// commit, and `pnpm db:sync-cms` retries whatever failed. Nothing here ever fails a request.
//
// It must not import `db/index.ts` (the app pool validates the web app's whole env), so the
// retry job can use it with its own connection.
import { z } from "zod";
import type { CmsOrderState, CmsProductState } from "~/lib/cms-sync";
import { cmsWrite } from "../cms/writer";
import type { Db } from "../db/client";
import {
  type ClaimedCmsSync,
  claimCmsSync,
  markCmsSynced,
  markCmsSyncFailed,
} from "../db/queries/cms-outbox";
import { findOrderSyncState, type OrderSyncRow } from "../db/queries/orders";
import {
  backfillProductSlugs,
  findProductSyncState,
  type ProductSyncRow,
} from "../db/queries/products";
import type { CmsSyncEnv } from "../env";

/** Minutes between push attempts; the last value repeats, so a row is retried until it lands. */
export const CMS_SYNC_RETRY_DELAYS_MINUTES = [1, 5, 15, 60] as const;

export const CMS_SYNC_BATCH_SIZE = 50;

const iso = (date: Date | null): string | null => date?.toISOString() ?? null;

export function toCmsOrderState({ order, items }: OrderSyncRow): CmsOrderState {
  return {
    orderId: order.id,
    status: order.status,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    customerName: order.guestFullName,
    customerEmail: order.guestEmail,
    customerPhone: order.guestPhone,
    userId: order.userId,
    shippingAddress: order.shippingAddress,
    freeShipping: order.freeShipping,
    subtotal: order.subtotal,
    discountAmount: order.discountAmount,
    shippingAmount: order.shippingAmount,
    totalAmount: order.totalAmount,
    currency: order.currency,
    placedAt: order.createdAt.toISOString(),
    paidAt: iso(order.paidAt),
    cancelledAt: iso(order.cancelledAt),
    refundedAt: iso(order.refundedAt),
    shippedAt: iso(order.shippedAt),
    completedAt: iso(order.completedAt),
    items,
  };
}

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

// Strapi stores amounts in `decimal` fields, which its REST API takes as JSON numbers. Strapi
// only displays them; the exact values stay in PostgreSQL.

/** The `data` of an order document in Strapi. */
export function toStrapiOrderData(order: CmsOrderState) {
  return {
    ...order,
    subtotal: Number(order.subtotal),
    discountAmount: Number(order.discountAmount),
    shippingAmount: Number(order.shippingAmount),
    totalAmount: Number(order.totalAmount),
    items: order.items.map((item) => ({ ...item, unitPrice: Number(item.unitPrice) })),
  };
}

/** The `data` of a product document in Strapi. The image is Strapi's own and isn't sent. */
export function toStrapiProductData(product: CmsProductState) {
  return {
    ...product,
    variants: product.variants.map((variant) => ({ ...variant, price: Number(variant.price) })),
  };
}

export interface CmsSyncDeps {
  env: CmsSyncEnv;
  claim(options: { only?: ClaimOnly; limit: number }): Promise<ClaimedCmsSync[]>;
  loadOrder(orderId: number): Promise<CmsOrderState | undefined>;
  loadProduct(productId: number): Promise<CmsProductState | undefined>;
  markSynced(id: number, version: number): Promise<void>;
  markFailed(id: number, version: number, error: string): Promise<void>;
}

type ClaimOnly = NonNullable<Parameters<typeof claimCmsSync>[1]["only"]>;

export function cmsSyncDeps(db: Db, env: CmsSyncEnv): CmsSyncDeps {
  return {
    env,
    claim: (options) =>
      claimCmsSync(db, { ...options, retryDelaysMinutes: CMS_SYNC_RETRY_DELAYS_MINUTES }),
    loadOrder: async (orderId) => {
      const row = await findOrderSyncState(db, orderId);
      return row && toCmsOrderState(row);
    },
    loadProduct: async (productId) => {
      // Strapi requires a slug; products from before #40 get one on their first push.
      await backfillProductSlugs(db, [productId]);
      const row = await findProductSyncState(db, productId);
      return row && toCmsProductState(row);
    },
    markSynced: (id, version) => markCmsSynced(db, id, version),
    markFailed: (id, version, error) => markCmsSyncFailed(db, id, version, error),
  };
}

const documentList = z.object({ data: z.array(z.object({ documentId: z.string() })) });
const documentOne = z.object({ data: z.object({ documentId: z.string() }) });

/** Creates the document, or updates the one whose `key` field has this value. */
async function upsertDocument(
  env: CmsSyncEnv,
  collection: "orders" | "products",
  key: { field: string; value: string | number },
  data: unknown,
): Promise<void> {
  const found = await cmsWrite(
    env,
    {
      method: "GET",
      path: collection,
      query: { filters: { [key.field]: { $eq: key.value } }, fields: ["documentId"] },
    },
    documentList,
  );
  const [existing] = found.data;
  await cmsWrite(
    env,
    existing
      ? { method: "PUT", path: `${collection}/${existing.documentId}`, data }
      : { method: "POST", path: collection, data },
    documentOne,
  );
}

async function pushOne(row: ClaimedCmsSync, deps: CmsSyncDeps): Promise<void> {
  if (row.entity === "order") {
    const order = await deps.loadOrder(row.entityId);
    if (order) {
      await upsertDocument(
        deps.env,
        "orders",
        { field: "orderId", value: order.orderId },
        toStrapiOrderData(order),
      );
    }
  } else {
    const product = await deps.loadProduct(row.entityId);
    if (product) {
      await upsertDocument(
        deps.env,
        "products",
        { field: "publicId", value: product.publicId },
        toStrapiProductData(product),
      );
    }
  }
}

export interface CmsSyncReport {
  synced: number;
  failed: number;
  /** `STRAPI_SYNC_TOKEN` isn't set, so nothing was claimed. */
  skipped: boolean;
}

/**
 * Pushes due outbox rows to Strapi: only `only`'s entities (right after a change), or every due
 * row in batches (the retry job). Never rejects: failures are logged, kept on the row and left
 * to the retries. `deps` may be a factory, so building them can't throw either.
 */
export async function deliverCmsSync(
  { only, limit = CMS_SYNC_BATCH_SIZE }: { only?: ClaimOnly; limit?: number },
  deps: CmsSyncDeps | (() => CmsSyncDeps),
): Promise<CmsSyncReport> {
  const report: CmsSyncReport = { synced: 0, failed: 0, skipped: false };
  try {
    const resolved = typeof deps === "function" ? deps() : deps;
    if (!resolved.env.STRAPI_SYNC_TOKEN) {
      console.info("[cms-sync] STRAPI_SYNC_TOKEN is not set; changes stay queued for Strapi");
      return { ...report, skipped: true };
    }
    // Claimed rows aren't due again until their retry time, so this loop ends.
    for (;;) {
      const batch = await resolved.claim({ only, limit });
      for (const row of batch) {
        try {
          await pushOne(row, resolved);
          await resolved.markSynced(row.id, row.version);
          report.synced += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[cms-sync] Pushing ${row.entity} ${row.entityId} failed: ${message}`);
          await resolved.markFailed(row.id, row.version, message.slice(0, 1000));
          report.failed += 1;
        }
      }
      if (only !== undefined || batch.length < limit) break;
    }
  } catch (error) {
    console.error("[cms-sync] Pushing to Strapi failed:", error);
  }
  return report;
}

export function describeCmsSyncReport({ synced, failed, skipped }: CmsSyncReport): string {
  if (skipped) {
    return "STRAPI_SYNC_TOKEN is not set; nothing was pushed to Strapi.";
  }
  return `Pushed ${synced} change(s) to Strapi; ${failed} failed and will be retried.`;
}
