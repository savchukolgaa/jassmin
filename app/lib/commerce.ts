// App-level types for carts and orders (tables in app/.server/db/schema.ts). Plain data only,
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

export interface CartItem {
  id: number;
  cartId: number;
  productId: number;
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
  quantity: number;
  /** Unit price when the order was placed. */
  priceAtPurchase: string;
}
