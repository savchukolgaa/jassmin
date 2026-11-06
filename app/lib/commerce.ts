// App-level types for product variants, carts and orders (tables in app/.server/db/schema.ts). Plain data only,
// so loaders can return them and both server and client code can import them.
//
// Money is an exact decimal string (e.g. `"2450.00"`), never a float.
import type {
  CartStatus,
  DiscountKind,
  GiftCardStatus,
  OrderStatus,
  PaymentAttemptStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
} from "./enums";
import type { Locale } from "./i18n/locales";

export interface Cart {
  id: number;
  /** `null` for guest carts. */
  userId: number | null;
  /** Analytics visitor session (`sessions.session_id`). */
  sessionId: string | null;
  status: CartStatus;
  createdAt: Date;
  /** The shopper's last activity (every change to the cart's lines bumps it). */
  updatedAt: Date;
  /** When the abandoned-cart job marked the cart `abandoned`; `null` otherwise. */
  abandonedAt: Date | null;
  /** The promo code the shopper applied (`discounts.id`, #59). */
  discountId: number | null;
  /** The gift card applied at checkout (`gift_cards.id`, #125). */
  giftCardId: number | null;
}

export interface ProductVariant {
  id: number;
  publicId: string;
  productId: number;
  volumeMl: number;
  price: string;
  stockQuantity: number;
  /** `false`: always available, stock isn't counted (#98). */
  trackStock: boolean;
  createdAt: Date;
}

export interface CartItem {
  id: number;
  cartId: number;
  productId: number;
  /** The chosen size (`product_variants.id`). */
  variantId: number;
  quantity: number;
  addedAt: Date;
}

export interface Order {
  id: number;
  /** `null` for guest orders. */
  userId: number | null;
  guestFullName: string;
  guestEmail: string;
  guestPhone: string;
  /** Nova Poshta delivery details. */
  shippingAddress: string;
  /** The cart the order was placed from; `null` once that cart is deleted. */
  cartId: number | null;
  /** The store pays Nova Poshta; otherwise the recipient pays on delivery. */
  freeShipping: boolean;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  subtotal: string;
  discountAmount: string;
  shippingAmount: string;
  /** What a gift card paid (#125); `total_amount` is what's left to pay. */
  giftCardAmount: string;
  totalAmount: string;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
  paidAt: Date | null;
  cancelledAt: Date | null;
  refundedAt: Date | null;
  shippedAt: Date | null;
  completedAt: Date | null;
  /** When the parcel arrived at the Nova Poshta branch (#138). */
  arrivedAt: Date | null;
  /** The Nova Poshta waybill number (ТТН, #138). */
  waybillNumber: string | null;
  /** The discount rule applied at checkout (#59). */
  discountId: number | null;
}

export interface OrderItem {
  id: number;
  orderId: number;
  /** `null` once the product has been deleted; the order line is kept. */
  productId: number | null;
  /** `null` once the variant has been deleted, or for lines placed before variants existed. */
  variantId: number | null;
  /** Bought volume in ml, kept when the variant is deleted. */
  volumeMl: number | null;
  quantity: number;
  /** Unit price when the order was placed. */
  priceAtPurchase: string;
}

/** One attempt at paying a card order online (#44). */
export interface Payment {
  id: number;
  /** The card order being paid; `null` for a gift card purchase. */
  orderId: number | null;
  /** The gift card being bought (#125); `null` for an order's payment. */
  giftCardId: number | null;
  provider: PaymentProvider;
  /** The provider's order id for this attempt: `<order id>-<n>`, or `G<gift card id>-<n>`. */
  reference: string;
  status: PaymentAttemptStatus;
  /** The order total, or the gift card's amount, when the attempt started. */
  amount: string;
  currency: string;
  providerPaymentId: string | null;
  lastCallback: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

/** A gift card (#125): bought by card, spent at checkout until its balance or 12 months run out. */
export interface GiftCard {
  id: number;
  code: string;
  initialAmount: string;
  balance: string;
  currency: string;
  status: GiftCardStatus;
  /** `null` for a guest buyer. */
  buyerUserId: number | null;
  buyerEmail: string;
  /** Who the card is for, when the buyer named them. */
  recipientEmail: string | null;
  locale: Locale;
  /** The attempt that paid for the card. */
  paymentId: number | null;
  activatedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** What one order took off a gift card (#125). */
export interface GiftCardRedemption {
  id: number;
  giftCardId: number;
  orderId: number;
  amount: string;
  createdAt: Date;
  /** When the amount went back on the card (the order was cancelled or unclaimed). */
  reversedAt: Date | null;
}

/** A discount rule (#59): a promo code, or an automatic rule when `code` is `null`. */
export interface Discount {
  id: number;
  slug: string;
  code: string | null;
  kind: DiscountKind;
  /** The percent, the amount off, or the price of one set, depending on `kind`. */
  value: string;
  /** Scopes; `null` matches any line. */
  scopeVolumesMl: number[] | null;
  scopeProductPublicIds: string[] | null;
  scopePackSize: number | null;
  minQuantity: number;
  maxSets: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  maxRedemptions: number | null;
  redemptionCount: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}
