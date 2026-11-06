// Order status history (#128): one row per change of `orders.status`, written by whoever changed
// it (checkout, the payment callback, a Strapi edit, the unpaid-order job) inside the same
// transaction, with the same time as the lifecycle timestamp it set.
import { asc, eq } from "drizzle-orm";
import type { OrderStatusHistoryEntry } from "~/lib/commerce";
import type { OrderStatus, OrderStatusSource } from "~/lib/enums";
import type { Db } from "../client";
import { orderStatusHistory } from "../schema";

/** A `Db` or a transaction. */
type Executor = Pick<Db, "select" | "insert">;

export interface NewOrderStatusChange {
  orderId: number;
  /** The status the order moved to. */
  status: OrderStatus;
  source: OrderStatusSource;
  /** When it changed; the caller passes the time it stored on the order (`paid_at`, …). */
  changedAt: Date;
}

/** Records one status change. Call it in the transaction that changed `orders.status`. */
export async function insertOrderStatusHistory(
  db: Executor,
  change: NewOrderStatusChange,
): Promise<void> {
  await db.insert(orderStatusHistory).values(change);
}

/** The order's status changes, oldest first. */
export function listOrderStatusHistory(
  db: Executor,
  orderId: number,
): Promise<OrderStatusHistoryEntry[]> {
  return db
    .select()
    .from(orderStatusHistory)
    .where(eq(orderStatusHistory.orderId, orderId))
    .orderBy(asc(orderStatusHistory.changedAt), asc(orderStatusHistory.id));
}
