import { and, count, desc, eq } from "drizzle-orm";
import type { Payment } from "~/lib/commerce";
import type { PaymentAttemptStatus, PaymentProvider } from "~/lib/enums";
import type { Db } from "../client";
import { orders, payments } from "../schema";

// Card payment attempts (#44). The service runs these inside one transaction per change, so the
// order row (`findPayableOrder` with `lock`) or the attempt row (`lockPaymentByReference`) is
// locked before anything is written.

/** A `Db` or a transaction, so the payments service can pass `tx` down. */
type Executor = Pick<Db, "select" | "insert" | "update">;

/** What deciding whether an order can be paid needs; `lock` takes the row `FOR UPDATE`. */
export async function findPayableOrder(
  db: Executor,
  orderId: number,
  { lock = false }: { lock?: boolean } = {},
) {
  const query = db
    .select({
      id: orders.id,
      userId: orders.userId,
      paymentMethod: orders.paymentMethod,
      paymentStatus: orders.paymentStatus,
      status: orders.status,
      totalAmount: orders.totalAmount,
      currency: orders.currency,
    })
    .from(orders)
    .where(eq(orders.id, orderId));
  const [row] = await (lock ? query.for("update") : query);
  return row;
}

/** How many payment attempts the order has had, for the next attempt's reference. */
export async function countPayments(db: Executor, orderId: number): Promise<number> {
  const [row] = await db
    .select({ attempts: count() })
    .from(payments)
    .where(eq(payments.orderId, orderId));
  return row?.attempts ?? 0;
}

export interface NewPayment {
  orderId: number;
  provider: PaymentProvider;
  reference: string;
  /** The order's `total_amount`, never an amount from the request. */
  amount: string;
  currency: string;
}

/** Inserts a `pending` attempt and returns its id. */
export async function insertPayment(db: Executor, payment: NewPayment): Promise<number> {
  const [row] = await db.insert(payments).values(payment).returning({ id: payments.id });
  if (!row) {
    throw new Error("Could not insert the payment");
  }
  return row.id;
}

/** The attempt with this reference, locked `FOR UPDATE`; `undefined` when there is none. */
export async function lockPaymentByReference(
  db: Executor,
  reference: string,
): Promise<Payment | undefined> {
  const [row] = await db
    .select()
    .from(payments)
    .where(eq(payments.reference, reference))
    .for("update");
  return row;
}

export interface PaymentUpdate {
  status: PaymentAttemptStatus;
  providerPaymentId: string | null;
  lastCallback: Record<string, unknown>;
}

/** Records a callback on the attempt; `completed_at` is set once it leaves `pending`. */
export async function markPayment(
  db: Executor,
  paymentId: number,
  { status, providerPaymentId, lastCallback }: PaymentUpdate,
): Promise<void> {
  await db
    .update(payments)
    .set({
      status,
      providerPaymentId,
      lastCallback,
      ...(status === "pending" ? {} : { completedAt: new Date() }),
    })
    .where(eq(payments.id, paymentId));
}

/**
 * Marks the order paid, but only while it is still `pending` and `unpaid`, so a repeated callback
 * changes nothing. Returns whether the order changed.
 */
export async function markOrderPaid(db: Executor, orderId: number): Promise<boolean> {
  const rows = await db
    .update(orders)
    .set({ paymentStatus: "paid", status: "paid", paidAt: new Date() })
    .where(
      and(eq(orders.id, orderId), eq(orders.paymentStatus, "unpaid"), eq(orders.status, "pending")),
    )
    .returning({ id: orders.id });
  return rows.length > 0;
}

/** The status of the order's latest payment attempt, or `undefined` before the first one. */
export async function findLatestPaymentStatus(
  db: Executor,
  orderId: number,
): Promise<PaymentAttemptStatus | undefined> {
  const [row] = await db
    .select({ status: payments.status })
    .from(payments)
    .where(eq(payments.orderId, orderId))
    .orderBy(desc(payments.id))
    .limit(1);
  return row?.status;
}
