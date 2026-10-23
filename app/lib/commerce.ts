// App-level types for product variants, carts and orders (tables in app/.server/db/schema.ts). Plain data only,
// so loaders can return them and both server and client code can import them.
//
// Money is an exact decimal string (e.g. `"2450.00"`), never a float.
import type { CartStatus, OrderStatus, PaymentMethod, PaymentStatus } from "./enums";

export interface Cart {
  id: number;
  /** `null` for guest carts. */
  userId: number | null;
  /** Analytics visitor session (`sessions.session_id`). */
  sessionId: string | null;
  status: CartStatus;
  createdAt: Date;
  updatedAt: Date;
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
