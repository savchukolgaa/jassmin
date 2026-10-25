// Checkout form contract (#11) shared by the `/checkout` action and its form, plus the DTOs the
// checkout and order-confirmation loaders return. Isomorphic: no server imports. Error messages
// are message keys, translated when the form renders them.
import { z } from "zod";
import { type AuthFormErrors, emailSchema } from "./auth";
import type { CartLine } from "./cart";
import { PAYMENT_METHODS, type PaymentMethod } from "./enums";
import { msg, type TextKey } from "./i18n";

/** From this subtotal (after discount) the store pays Nova Poshta; below it the recipient does. */
export const FREE_SHIPPING_THRESHOLD = "1000.00";

/**
 * What the store charges for delivery: nothing. Below the threshold the recipient pays Nova
 * Poshta's own rate when collecting the parcel, so it's never part of the order total.
 */
export const SHIPPING_AMOUNT = "0.00";

/** No discounts or promo codes yet. */
export const DISCOUNT_AMOUNT = "0.00";

/**
 * A Ukrainian phone number as `+380XXXXXXXXX`, or `undefined` when it isn't one. Accepts
 * `+380 67 123 45 67`, `380671234567`, `(067) 123-45-67` and the like.
 */
export function normalizeUkrainianPhone(raw: string): string | undefined {
  const match = /^(?:\+?38)?(0\d{9})$/.exec(raw.replace(/[\s()-]/g, ""));
  return match ? `+38${match[1]}` : undefined;
}

const requiredText = (max: number, required: TextKey, tooLong: TextKey) =>
  z
    .string({ error: msg(required) })
    .trim()
    .min(1, msg(required))
    .max(max, msg(tooLong));

export const checkoutSchema = z.object({
  fullName: requiredText(
    255,
    "checkout.errors.fullNameRequired",
    "checkout.errors.fullNameTooLong",
  ),
  email: emailSchema,
  // Normalised, so `orders.guest_phone` matches however the number was typed (identity resolution).
  phone: z.string({ error: msg("checkout.errors.phoneInvalid") }).transform((value, ctx) => {
    const phone = normalizeUkrainianPhone(value);
    if (phone === undefined) {
      ctx.addIssue({ code: "custom", message: msg("checkout.errors.phoneInvalid") });
      return z.NEVER;
    }
    return phone;
  }),
  city: requiredText(100, "checkout.errors.cityRequired", "checkout.errors.cityTooLong"),
  branch: requiredText(255, "checkout.errors.branchRequired", "checkout.errors.branchTooLong"),
  paymentMethod: z.enum(PAYMENT_METHODS, { error: msg("checkout.errors.paymentRequired") }),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;

export const CHECKOUT_FIELDS = [
  "fullName",
  "email",
  "phone",
  "city",
  "branch",
  "paymentMethod",
] as const;

export type CheckoutField = (typeof CHECKOUT_FIELDS)[number];

/** What the checkout `action` returns when the order can't be placed. Errors are keys. */
export type CheckoutFormErrors = AuthFormErrors<CheckoutField>;

/** Validates a checkout form submission. */
export function parseCheckout(formData: FormData) {
  return checkoutSchema.safeParse(Object.fromEntries(formData));
}

/** The submitted values, to refill the form after an error. */
export function checkoutValues(formData: FormData): Partial<Record<CheckoutField, string>> {
  const values: Partial<Record<CheckoutField, string>> = {};
  for (const field of CHECKOUT_FIELDS) {
    const value = formData.get(field);
    if (typeof value === "string") values[field] = value;
  }
  return values;
}

/** `orders.shipping_address`: one locale-independent line, e.g. `Київ, Відділення №12`. */
export function formatShippingAddress({ city, branch }: { city: string; branch: string }): string {
  return `${city}, ${branch}`;
}

/** An exact `numeric(10, 2)` string (e.g. `"999.5"`, `"1000.00"`) as whole kopiyky. */
function toKopiyky(amount: string): number {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(amount);
  if (!match) {
    throw new Error(`Not a money amount: ${amount}`);
  }
  return Number(match[1] ?? "0") * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

function fromKopiyky(kopiyky: number): string {
  return `${Math.floor(kopiyky / 100)}.${String(kopiyky % 100).padStart(2, "0")}`;
}

export type FreeShippingInfo = { free: true } | { free: false; remaining: string };

/**
 * Whether a subtotal gets free delivery, else how much is missing (a decimal string). Works on
 * whole kopiyky, so there's no float rounding; the order's `free_shipping` is computed in SQL.
 */
export function freeShippingInfo(subtotal: string): FreeShippingInfo {
  const missing = toKopiyky(FREE_SHIPPING_THRESHOLD) - toKopiyky(subtotal);
  return missing <= 0 ? { free: true } : { free: false, remaining: fromKopiyky(missing) };
}

/** Message keys for a payment method's name and what happens next. */
export const PAYMENT_KEYS: Record<PaymentMethod, { label: TextKey; note: TextKey }> = {
  card: { label: "checkout.payment.card", note: "checkout.payment.cardNote" },
  cod: { label: "checkout.payment.cod", note: "checkout.payment.codNote" },
};

/** The largest `orders.id` (a PostgreSQL `integer`, serial). */
const MAX_ORDER_ID = 2_147_483_647;

/** An order id from a route param, or `null` when it can't be one, so no lookup is made. */
export function parseOrderId(param: string | undefined): number | null {
  if (param === undefined || !/^\d{1,10}$/.test(param)) return null;
  const id = Number(param);
  return id > 0 && id <= MAX_ORDER_ID ? id : null;
}

/** Contact details to prefill the form with for a logged-in user. */
export interface CheckoutPrefill {
  fullName: string;
  email: string;
  phone: string | null;
}

/** One line of an order summary, from the cart (checkout) or a placed order (confirmation). */
export interface OrderSummaryLine {
  key: string;
  /** `null` once the product has been deleted. */
  title: string | null;
  brand: string | null;
  /** `null` for order lines whose size wasn't recorded. */
  volumeMl: number | null;
  packSize: number | null;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
}

export function cartSummaryLine(line: CartLine): OrderSummaryLine {
  return {
    key: line.variantId,
    title: line.title,
    brand: line.brand,
    volumeMl: line.volumeMl,
    packSize: line.packSize,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    lineTotal: line.lineTotal,
  };
}

/** A placed order as its success page shows it. Amounts are exact decimal strings. */
export interface OrderConfirmation {
  id: number;
  createdAt: Date;
  fullName: string;
  email: string;
  phone: string;
  shippingAddress: string;
  paymentMethod: PaymentMethod;
  freeShipping: boolean;
  subtotal: string;
  discountAmount: string;
  shippingAmount: string;
  totalAmount: string;
  lines: OrderSummaryLine[];
}
