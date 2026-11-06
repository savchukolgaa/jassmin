import type { Core } from "@strapi/strapi";
import { errors } from "@strapi/utils";
import { AppSyncError, postToApp } from "../utils/app-sync";

/**
 * Write-through for products and orders (#40). The shop's PostgreSQL database is the system of
 * record (checkout locks and decrements stock there), and the Strapi admin is where staff edit
 * it. Before Strapi saves a staff edit, this document middleware sends it to the app's
 * `/cms/products` or `/cms/orders/:id` route. The app applies it in one transaction and answers
 * with what it stored (real stock, the order's timestamps), which is what Strapi then saves.
 * When the app refuses, the save fails with its message in the admin and nothing changes.
 *
 * Only staff edits made in the admin panel go through the app. Writes with an API token (the
 * app pushing new orders and stock with `STRAPI_SYNC_TOKEN`) and scripts without a request pass
 * straight through, so a push never loops back.
 */

export const PRODUCT_UID = "api::product.product";
export const ORDER_UID = "api::order.order";
/** Gift cards (#125) are read-only in the admin: only the app's pushes write them. */
export const GIFT_CARD_UID = "api::gift-card.gift-card";

/** The document actions that change data; reads (and this middleware's own lookups) pass. */
const WRITE_ACTIONS = new Set(["create", "update", "delete", "clone"]);

type Data = Record<string, unknown>;

interface DocumentContext {
  uid: string;
  action: string;
  params: { documentId?: string; data?: Data };
}

type DocumentMiddleware = Parameters<Core.Strapi["documents"]["use"]>[0];

const isRecord = (value: unknown): value is Data =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const records = (value: unknown): Data[] => (Array.isArray(value) ? value.filter(isRecord) : []);

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

/** `NaN` for a missing value, so the app's validation names the field. */
const toNumber = (value: unknown): number =>
  value === null || value === undefined || value === "" ? Number.NaN : Number(value);

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;

/**
 * The `field` of each row of a repeatable component, e.g. the families of
 * `[{ id: 1, family: "квіткові" }]` (#65). Kept in order, since the first family is the primary.
 */
export const componentValues = (rows: unknown, field: string): unknown[] =>
  records(rows).map((row) => row[field]);

/** The repeatable components of a product, populated when the stored product is read. */
export const PRODUCT_COMPONENTS = ["variants", "fragranceFamilies", "notes"] as const;

/** Whether the current request is a staff member's, made in the admin panel. */
export function isStaffEdit(strapi: Core.Strapi): boolean {
  const state: unknown = strapi.requestContext.get()?.state;
  if (!isRecord(state) || !isRecord(state.auth) || !isRecord(state.auth.strategy)) {
    return false;
  }
  const { name } = state.auth.strategy;
  return typeof name === "string" && name.startsWith("admin");
}

/** The image as the app stores it (#88): its URL (`/uploads/…`), size and resized formats. */
export interface ImageData {
  url: string;
  width: number | null;
  height: number | null;
  formats: { url: string; width: number; height: number }[];
}

const positiveInt = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;

/** An upload file's data, or `null` when it has no URL. */
export function toImageData(file: unknown): ImageData | null {
  if (!isRecord(file) || typeof file.url !== "string") {
    return null;
  }
  const formats = isRecord(file.formats) ? Object.values(file.formats) : [];
  return {
    url: file.url,
    width: positiveInt(file.width),
    height: positiveInt(file.height),
    formats: formats.flatMap((format) => {
      if (!isRecord(format) || typeof format.url !== "string") {
        return [];
      }
      const width = positiveInt(format.width);
      const height = positiveInt(format.height);
      return width && height ? [{ url: format.url, width, height }] : [];
    }),
  };
}

/**
 * The image from a media id or a media object, read from the upload table when there is an id
 * (the admin's media object may lack the formats), or nothing.
 */
async function imageData(strapi: Core.Strapi, image: unknown): Promise<ImageData | null> {
  const id = typeof image === "number" ? image : isRecord(image) ? image.id : undefined;
  if (typeof id !== "number") {
    return toImageData(image);
  }
  const file: unknown = await strapi.db.query("plugin::upload.file").findOne({ where: { id } });
  return toImageData(file) ?? toImageData(image);
}

/** The product as the app's `cmsProductChangeSchema` expects it (without `action`). */
export async function productPayload(strapi: Core.Strapi, merged: Data, stored: Data | null) {
  const storedStock = new Map(
    records(stored?.variants).map((variant) => [
      toNumber(variant.volumeMl),
      toNumber(variant.stock),
    ]),
  );
  const image = await imageData(strapi, merged.image);
  return {
    name: merged.name,
    slug: merged.slug,
    brand: merged.brand,
    description: text(merged.description),
    descriptionEn: text(merged.descriptionEn),
    gender: merged.gender,
    fragranceFamilies: componentValues(merged.fragranceFamilies, "family"),
    notes: componentValues(merged.notes, "name"),
    storeCode: text(merged.storeCode),
    // An emptied number field is `null`: the product leaves the popular list (#67).
    popularRank:
      merged.popularRank === undefined || merged.popularRank === null || merged.popularRank === ""
        ? null
        : toNumber(merged.popularRank),
    imageUrl: image?.url ?? null,
    imageWidth: image?.width ?? null,
    imageHeight: image?.height ?? null,
    imageFormats: image?.formats ?? null,
    packSize:
      merged.packSize === undefined || merged.packSize === null ? 1 : toNumber(merged.packSize),
    active: merged.active !== false,
    variants: records(merged.variants).map((variant) => {
      const volumeMl = toNumber(variant.volumeMl);
      const expectedStock = storedStock.get(volumeMl) ?? null;
      return {
        volumeMl,
        price: toNumber(variant.price),
        trackStock: variant.trackStock === true,
        // The admin leaves out the stock it hides while Track stock is off (#98): keep the stored one.
        stock:
          variant.stock === undefined || variant.stock === null || variant.stock === ""
            ? (expectedStock ?? 0)
            : toNumber(variant.stock),
        expectedStock,
      };
    }),
  };
}

/**
 * Writes the app's answer into the data Strapi is about to save, keeping the sizes' ids. Families,
 * notes, the store code and the popular position are saved as the app normalised them (trimmed,
 * repeats dropped).
 */
export function applyProductAnswer(data: Data, answer: unknown): Data {
  if (!isRecord(answer) || typeof answer.publicId !== "string") {
    throw new AppSyncError("Магазин надіслав неочікувану відповідь. Зміни не збережено.");
  }
  const byVolume = new Map(records(answer.variants).map((v) => [toNumber(v.volumeMl), v]));
  return {
    ...data,
    publicId: answer.publicId,
    active: answer.active,
    // Trimmed by the app, and `null` once emptied (#100).
    description: typeof answer.description === "string" ? answer.description : null,
    descriptionEn: typeof answer.descriptionEn === "string" ? answer.descriptionEn : null,
    fragranceFamilies: strings(answer.fragranceFamilies).map((family) => ({ family })),
    notes: strings(answer.notes).map((name) => ({ name })),
    storeCode: typeof answer.storeCode === "string" ? answer.storeCode : null,
    popularRank: typeof answer.popularRank === "number" ? answer.popularRank : null,
    variants: records(data.variants).map((variant) => {
      const stored = byVolume.get(toNumber(variant.volumeMl));
      return stored
        ? {
            ...variant,
            price: toNumber(stored.price),
            stock: stored.stock,
            trackStock: stored.trackStock === true,
          }
        : variant;
    }),
  };
}

/**
 * The app's order (`CmsOrderState`) as Strapi data: `status` is `orderStatus` (Strapi reserves
 * `status` for draft & publish) and amounts are numbers for `decimal`.
 */
export function toOrderData(answer: unknown): Data {
  if (!isRecord(answer) || typeof answer.orderId !== "number") {
    throw new AppSyncError("Магазин надіслав неочікувану відповідь. Зміни не збережено.");
  }
  const { status, ...order } = answer;
  return {
    ...order,
    orderStatus: status,
    subtotal: toNumber(answer.subtotal),
    discountAmount: toNumber(answer.discountAmount),
    shippingAmount: toNumber(answer.shippingAmount),
    totalAmount: toNumber(answer.totalAmount),
    giftCardAmount: toNumber(answer.giftCardAmount),
    items: records(answer.items).map((item) => ({ ...item, unitPrice: toNumber(item.unitPrice) })),
  };
}

/**
 * What staff changed on an order, for `/cms/orders/:id`: the statuses, the waybill number and
 * the "arrived at the branch" checkbox (#138). A field the form didn't send stays as it is; a
 * cleared waybill is sent as `null`, which removes it.
 */
export function toOrderChange(data: Data): Data {
  return {
    status: data.orderStatus ?? undefined,
    paymentStatus: data.paymentStatus ?? undefined,
    arrivedAtBranch: typeof data.arrivedAtBranch === "boolean" ? data.arrivedAtBranch : undefined,
    waybillNumber: "waybillNumber" in data ? (data.waybillNumber ?? null) : undefined,
  };
}

async function findStored(strapi: Core.Strapi, uid: string, documentId: string | undefined) {
  if (!documentId) return null;
  const documents = strapi.documents(uid as typeof PRODUCT_UID);
  const stored: unknown = await documents.findOne({
    documentId,
    populate: uid === PRODUCT_UID ? [...PRODUCT_COMPONENTS, "image"] : [],
  });
  return isRecord(stored) ? stored : null;
}

async function syncProduct(strapi: Core.Strapi, context: DocumentContext): Promise<void> {
  const { action, params } = context;
  if (action === "clone") {
    throw new AppSyncError("Товари не можна дублювати: створіть новий товар.");
  }
  const stored = await findStored(strapi, PRODUCT_UID, params.documentId);
  const publicId = typeof stored?.publicId === "string" ? stored.publicId : null;

  if (action === "delete") {
    // Archived in the shop, so its orders keep their title; nothing to do for a product the
    // shop never had.
    if (publicId) {
      await postToApp("/cms/products", { action: "delete", publicId });
    }
    return;
  }
  if (action !== "create" && action !== "update") {
    return;
  }

  const data = params.data ?? {};
  const merged = { ...(stored ?? {}), ...data };
  const payload = await productPayload(strapi, merged, stored);
  const answer = await postToApp(
    "/cms/products",
    publicId ? { action: "update", publicId, ...payload } : { action: "create", ...payload },
  );
  params.data = applyProductAnswer(data, answer);
}

async function syncOrder(strapi: Core.Strapi, context: DocumentContext): Promise<void> {
  const { action, params } = context;
  if (action === "create" || action === "clone") {
    throw new AppSyncError("Замовлення створюються лише в магазині під час оформлення.");
  }
  if (action === "delete") {
    throw new AppSyncError(
      "Замовлення не можна видаляти: змініть статус, наприклад на «Скасоване».",
    );
  }
  if (action !== "update") {
    return;
  }
  const stored = await findStored(strapi, ORDER_UID, params.documentId);
  if (typeof stored?.orderId !== "number") {
    throw new AppSyncError("Цього замовлення немає в базі магазину.");
  }
  const answer = await postToApp(`/cms/orders/${stored.orderId}`, toOrderChange(params.data ?? {}));
  // Every other field is the shop's: whatever the form sent, Strapi stores the app's values.
  params.data = toOrderData(answer);
}

export function createSyncMiddleware(strapi: Core.Strapi): DocumentMiddleware {
  const middleware = async (context: DocumentContext, next: () => Promise<unknown>) => {
    if (
      (context.uid !== PRODUCT_UID && context.uid !== ORDER_UID && context.uid !== GIFT_CARD_UID) ||
      !WRITE_ACTIONS.has(context.action) ||
      !isStaffEdit(strapi)
    ) {
      return next();
    }
    try {
      if (context.uid === GIFT_CARD_UID) {
        throw new AppSyncError(
          "Подарункові картки змінюються лише в магазині: тут їх можна тільки переглядати.",
        );
      }
      if (context.uid === PRODUCT_UID) {
        await syncProduct(strapi, context);
      } else {
        await syncOrder(strapi, context);
      }
    } catch (error) {
      if (error instanceof AppSyncError) {
        throw new errors.ApplicationError(error.message);
      }
      throw error;
    }
    return next();
  };
  return middleware as unknown as DocumentMiddleware;
}
