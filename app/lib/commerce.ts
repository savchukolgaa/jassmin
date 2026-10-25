// App-level types for product variants, carts and orders (tables in app/.server/db/schema.ts). Plain data only,
// so loaders can return them and both server and client code can import them.
//
// Money is an exact decimal string (e.g. `"2450.00"`), never a float.
import type {
  CartStatus,
  OrderStatus,
  PaymentAttemptStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
} from "./enums";

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
}

export interface ProductVariant {
  id: number;
  publicId: string;
  productId: number;
  volumeMl: number;
  price: string;
  stockQuantity: number;
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
  totalAmount: string;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
  paidAt: Date | null;
  cancelledAt: Date | null;
  refundedAt: Date | null;
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
  orderId: number;
  provider: PaymentProvider;
  /** The provider's order id for this attempt: `<order id>-<attempt number>`. */
  reference: string;
  status: PaymentAttemptStatus;
  /** The order total when the attempt started. */
  amount: string;
  currency: string;
  providerPaymentId: string | null;
  lastCallback: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}
