// `pnpm db:cancel-unpaid-orders` (#128): cancels card orders nobody paid for. A card order is
// placed `pending` / `unpaid` and waits for the provider's callback; when it's still unpaid
// `UNPAID_ORDER_HOURS` (default 48) after checkout, and no payment was started in the last
// `RECENT_PAYMENT_ATTEMPT_MINUTES`, the job cancels it with the reason `payment_failed`. That
// puts its units back in stock and what a gift card paid back on the card, records the change in
// `order_status_history` (`job`) and queues the order, products and cards for Strapi
// (`pnpm db:sync-cms` pushes them). Run it hourly from an external scheduler; the CLI wrapper is
// scripts/cancel-unpaid-orders.ts.
//
// Each order is cancelled in its own transaction, under its row lock, after checking again that
// it's still unpaid with no recent attempt: `startPayment` locks the order before it starts an
// attempt, so the two can't race. A payment that succeeds after the cancel leaves the order
// cancelled and logs a warning for a manual refund (`handlePaymentCallback`).
//
// It must not import `db/index.ts` (the CLI runs without the web app's env).
import { z } from "zod";
import { changeOrderStatus } from "../services/order-lifecycle";
import type { Db } from "./client";
import { enqueueCmsSync } from "./queries/cms-outbox";
import { listUnpaidCardOrderIds, lockOrderLifecycle } from "./queries/orders";

export const DEFAULT_UNPAID_ORDER_HOURS = 48;

/** A payment started this recently means the shopper may still be on the provider's page. */
export const RECENT_PAYMENT_ATTEMPT_MINUTES = 60;

const hoursSchema = z.coerce.number().int().positive().default(DEFAULT_UNPAID_ORDER_HOURS);

/** Reads `UNPAID_ORDER_HOURS` (default 48); an empty value counts as unset. */
export function parseUnpaidOrderHours(
  source: NodeJS.ProcessEnv,
): { ok: true; hours: number } | { ok: false; error: string } {
  const result = hoursSchema.safeParse(source.UNPAID_ORDER_HOURS || undefined);
  if (!result.success) {
    return {
      ok: false,
      error: `UNPAID_ORDER_HOURS must be a positive whole number of hours, got "${source.UNPAID_ORDER_HOURS}".`,
    };
  }
  return { ok: true, hours: result.data };
}

/** Runs the job; returns the orders it cancelled and the message to log. */
export async function cancelUnpaidOrders(
  db: Db,
  { hours, now = new Date() }: { hours: number; now?: Date },
): Promise<{ cancelled: number[]; message: string }> {
  const cutoffs = {
    placedBefore: new Date(now.getTime() - hours * 3_600_000),
    noAttemptSince: new Date(now.getTime() - RECENT_PAYMENT_ATTEMPT_MINUTES * 60_000),
  };
  const cancelled: number[] = [];
  for (const orderId of await listUnpaidCardOrderIds(db, cutoffs)) {
    const done = await db.transaction(async (tx) => {
      // Lock first, then check again: it may have been paid or retried since the list was read.
      if (!(await lockOrderLifecycle(tx, orderId))) return false;
      const [stillUnpaid] = await listUnpaidCardOrderIds(tx, cutoffs, orderId);
      if (stillUnpaid === undefined) return false;
      const result = await changeOrderStatus(
        tx,
        orderId,
        { status: "cancelled", cancelReason: "payment_failed" },
        { source: "job", now },
      );
      if (!result.ok) {
        throw new Error(`Could not cancel unpaid order ${orderId}: ${result.error}`);
      }
      // Strapi shows the cancelled order (staff didn't make this change there).
      await enqueueCmsSync(tx, "order", [orderId]);
      return true;
    });
    if (done) cancelled.push(orderId);
  }
  const orders = cancelled.length === 1 ? "order" : "orders";
  return {
    cancelled,
    message: `Cancelled ${cancelled.length} card ${orders} still unpaid after ${hours} h.`,
  };
}
