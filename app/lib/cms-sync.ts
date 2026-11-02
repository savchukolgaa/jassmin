// What Strapi and the app send each other when staff edit products and orders in the Strapi
// admin (#40). Strapi's document middleware (`cms/src/sync/`) POSTs a change to `/cms/products`
// or `/cms/orders/:id`; the app validates it with these schemas, applies it in one transaction
// and answers with the authoritative state, which Strapi then saves. Isomorphic: no server
// imports. Money is an exact decimal string.
import { z } from "zod";
import {
  FRAGRANCE_FAMILIES,
  type FragranceFamily,
  GENDERS,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  PERFUME_VOLUMES_ML,
  type PerfumeVolumeMl,
} from "./enums";

/** A price from Strapi (a JSON number or a string), as an exact decimal string over 0. */
const priceSchema = z
  .union([z.number(), z.string()])
  .transform((value) => String(value).trim())
  .pipe(z.string().regex(/^\d{1,8}(\.\d{1,2})?$/, "price"))
  .refine((value) => Number(value) > 0, "price")
  .transform((value) => Number(value).toFixed(2));

/** The longest product description the app takes, in characters (#100): a sanity cap. */
export const MAX_PRODUCT_DESCRIPTION = 5000;

/** A product description in one language: plain text, a blank line between paragraphs. */
const descriptionText = z
  .string()
  .trim()
  .max(MAX_PRODUCT_DESCRIPTION)
  .nullish()
  .transform((value) => (value ? value : null));

export const cmsVariantSchema = z.object({
  volumeMl: z
    .number()
    .int()
    .refine((value): value is PerfumeVolumeMl =>
      (PERFUME_VOLUMES_ML as readonly number[]).includes(value),
    ),
  price: priceSchema,
  /** The stock staff typed. */
  stock: z.number().int().min(0),
  /**
   * The stock Strapi showed before this edit, if the size existed. The app applies the
   * difference, so sales made while the form was open aren't overwritten.
   */
  expectedStock: z.number().int().min(0).nullish(),
});

export type CmsVariantInput = z.infer<typeof cmsVariantSchema>;

/** The most notes a product may list (#65). */
export const MAX_PRODUCT_NOTES = 40;

/**
 * Scent notes (#65): trimmed, empty entries dropped and repeats (ignoring case) dropped, in the
 * order staff entered them.
 */
const notesSchema = z
  .array(z.string().trim().max(100))
  .default([])
  .transform((notes) => {
    const seen = new Set<string>();
    return notes.filter((note) => {
      const key = note.toLocaleLowerCase("uk");
      if (!note || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  })
  .pipe(z.array(z.string()).max(MAX_PRODUCT_NOTES));

/** Strapi makes up to four formats (thumbnail, small, medium, large); room for custom ones. */
export const MAX_IMAGE_FORMATS = 8;

/** Strapi's relative `/uploads/…` URL or an absolute `http(s)` one. */
const imageUrlSchema = z
  .string()
  .trim()
  .max(2000)
  .refine(
    (value) =>
      (value.startsWith("/") && !value.startsWith("//")) ||
      (URL.canParse(value) && /^https?:$/.test(new URL(value).protocol)),
    "image-url",
  );

const pixels = z.number().int().min(1).max(100_000);

const imagePixels = pixels.nullish().transform((value) => value ?? null);

const productFields = {
  name: z.string().trim().min(1).max(255),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .regex(/^[A-Za-z0-9._~-]+$/)
    // `/products/<uuid>` resolves by `public_id` first (#83), so such a slug could never be
    // reached.
    .refine((slug) => !z.uuid().safeParse(slug).success, "uuid-slug"),
  brand: z.string().trim().min(1).max(255),
  /** In Ukrainian. */
  description: descriptionText,
  /** In English (#100); the English page falls back to `description` when it's empty. */
  descriptionEn: descriptionText,
  gender: z.enum(GENDERS),
  /** Primary first (#65); the app mirrors the first into `products.fragrance_family`. */
  fragranceFamilies: z
    .array(z.enum(FRAGRANCE_FAMILIES))
    .default([])
    .refine((families) => new Set(families).size === families.length, "duplicate-family"),
  notes: notesSchema,
  /** The shop's own code for the bottle, e.g. `3-D` (#65). */
  storeCode: z
    .string()
    .trim()
    .max(20)
    .nullish()
    .transform((value) => (value ? value : null)),
  /** Position on `/popular` (#67): 1 is first; empty means not on the list. */
  popularRank: z
    .number()
    .int()
    .min(1)
    .max(9999)
    .nullish()
    .transform((value) => value ?? null),
  /** Strapi's relative `/uploads/…` URL or an absolute `http(s)` one; the route resolves it. */
  imageUrl: imageUrlSchema.nullish().transform((value) => value ?? null),
  /** The original image's size (#88); `null` when Strapi doesn't know it. */
  imageWidth: imagePixels,
  imageHeight: imagePixels,
  /**
   * Strapi's resized versions of the image (#88), URLs like `imageUrl`. `null` when the sender
   * doesn't send them (a Strapi from before #88).
   */
  imageFormats: z
    .array(z.object({ url: imageUrlSchema, width: pixels, height: pixels }))
    .max(MAX_IMAGE_FORMATS)
    .nullish()
    .transform((value) => value ?? null),
  packSize: z.number().int().min(1).default(1),
  active: z.boolean().default(true),
  variants: z
    .array(cmsVariantSchema)
    .min(1)
    .refine(
      (variants) => new Set(variants.map((v) => v.volumeMl)).size === variants.length,
      "duplicate-volume",
    ),
};

/** A single perfume needs a family; a set of several (`packSize > 1`) may have none (#65). */
function requireFamily(
  product: { packSize: number; fragranceFamilies: readonly FragranceFamily[] },
  ctx: z.RefinementCtx,
) {
  if (product.packSize === 1 && product.fragranceFamilies.length === 0) {
    ctx.addIssue({ code: "custom", path: ["fragranceFamilies"], message: "family-required" });
  }
}

export const cmsProductChangeSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), ...productFields }).superRefine(requireFamily),
  z
    .object({ action: z.literal("update"), publicId: z.uuid(), ...productFields })
    .superRefine(requireFamily),
  z.object({ action: z.literal("delete"), publicId: z.uuid() }),
]);

export type CmsProductChange = z.infer<typeof cmsProductChangeSchema>;

export type CmsProductFields = Omit<Extract<CmsProductChange, { action: "create" }>, "action">;

/** The product as the app stores it, for Strapi to save. */
export interface CmsProductState {
  publicId: string;
  name: string;
  slug: string | null;
  brand: string;
  description: string | null;
  descriptionEn: string | null;
  gender: (typeof GENDERS)[number];
  /** Primary first; rows from before #65 may hold a value outside `FRAGRANCE_FAMILIES`. */
  fragranceFamilies: string[];
  notes: string[];
  storeCode: string | null;
  popularRank: number | null;
  packSize: number;
  active: boolean;
  /** Smallest first, with the real stock. */
  variants: { volumeMl: number; price: string; stock: number }[];
}

export const cmsOrderChangeSchema = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
});

export type CmsOrderChange = z.infer<typeof cmsOrderChangeSchema>;

/** One line of an order in Strapi: a snapshot, so a later product edit doesn't change it. */
export interface CmsOrderItem {
  productPublicId: string | null;
  productName: string | null;
  brand: string | null;
  volumeMl: number | null;
  quantity: number;
  unitPrice: string;
}

/** The order as the app stores it, for Strapi to save. Timestamps are ISO strings. */
export interface CmsOrderState {
  orderId: number;
  status: (typeof ORDER_STATUSES)[number];
  paymentStatus: (typeof PAYMENT_STATUSES)[number];
  paymentMethod: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  /** `null` for guests. */
  userId: number | null;
  shippingAddress: string;
  freeShipping: boolean;
  subtotal: string;
  discountAmount: string;
  shippingAmount: string;
  totalAmount: string;
  currency: string;
  placedAt: string;
  paidAt: string | null;
  cancelledAt: string | null;
  refundedAt: string | null;
  shippedAt: string | null;
  completedAt: string | null;
  items: CmsOrderItem[];
}

/** Why the app refused a change; Strapi shows it to staff (`cms/src/utils/app-sync.ts`). */
export type CmsSyncError =
  | { error: "invalid-input"; issues: { path: string; message: string }[] }
  | { error: "unknown-product" }
  | { error: "unknown-order" }
  | { error: "slug-taken"; slug: string }
  | { error: "invalid-transition" | "card-not-paid"; from: string; to: string }
  | { error: "invalid-payment-transition"; from: string; to: string };

/** Zod issues as `{ path, message }` pairs, e.g. `variants.0.volumeMl`. */
export function toSyncIssues(error: z.ZodError): { path: string; message: string }[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
}
