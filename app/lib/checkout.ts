// Checkout form contract (#11) shared by the `/checkout` action and its form, plus the DTOs the
// checkout and order-confirmation loaders return. Isomorphic: no server imports. Error messages
// are message keys, translated when the form renders them.
import type { AuthFormErrors } from "./auth";
import type { CartLine } from "./cart";
import type { DiscountLine } from "./discounts";
import type { PaymentMethod } from "./enums";
import type { TextKey } from "./i18n";
import { fromKopiyky, toKopiyky } from "./money";

export type { CheckoutInput } from "./checkout.schema";

/** From this subtotal (after discount) the store pays Nova Poshta; below it the recipient does. */
export const FREE_SHIPPING_THRESHOLD = "1500.00";

/**
 * What the store charges for delivery: nothing. Below the threshold the recipient pays Nova
 * Poshta's own rate when collecting the parcel, so it's never part of the order total.
 */
export const SHIPPING_AMOUNT = "0.00";

/**
 * A Ukrainian phone number as `+380XXXXXXXXX`, or `undefined` when it isn't one. Accepts
 * `+380 67 123 45 67`, `380671234567`, `(067) 123-45-67` and the like.
 */
export function normalizeUkrainianPhone(raw: string): string | undefined {
  const match = /^(?:\+?38)?(0\d{9})$/.exec(raw.replace(/[\s()-]/g, ""));
  return match ? `+38${match[1]}` : undefined;
}

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
  gift_card: { label: "checkout.payment.giftCard", note: "checkout.payment.giftCardNote" },
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
  /** The applied discount (#59), or `null`. */
  discount: DiscountLine | null;
  shippingAmount: string;
  totalAmount: string;
  lines: OrderSummaryLine[];
}

/**
 * Where a card order's online payment stands, for its success page (#44): `paid`, `failed` (the
 * latest attempt was declined) or `pending` (no attempt yet, or no answer from the provider yet).
 * Both of the last two can start a new attempt.
 */
export type PaymentView = "paid" | "pending" | "failed";
