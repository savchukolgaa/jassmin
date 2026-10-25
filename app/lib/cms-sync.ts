// What Strapi and the app send each other when staff edit products and orders in the Strapi
// admin (#40). Strapi's document middleware (`cms/src/sync/`) POSTs a change to `/cms/products`
// or `/cms/orders/:id`; the app validates it with these schemas, applies it in one transaction
// and answers with the authoritative state, which Strapi then saves. Isomorphic: no server
// imports. Money is an exact decimal string.
import { z } from "zod";
import {
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

const optionalText = z
  .string()
  .trim()
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

const productFields = {
  name: z.string().trim().min(1).max(255),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .regex(/^[A-Za-z0-9._~-]+$/),
  brand: z.string().trim().min(1).max(255),
  description: optionalText,
  gender: z.enum(GENDERS),
  fragranceFamily: optionalText,
  imageUrl: z
    .url({ protocol: /^https?$/ })
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

export const cmsProductChangeSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), ...productFields }),
  z.object({ action: z.literal("update"), publicId: z.uuid(), ...productFields }),
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
  gender: (typeof GENDERS)[number];
  fragranceFamily: string | null;
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
