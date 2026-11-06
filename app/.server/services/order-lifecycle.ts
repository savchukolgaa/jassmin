// One way to change an order's status after checkout (#40, #128), shared by the Strapi
// write-through (`applyCmsOrderChange`) and the unpaid-order job (`cancelUnpaidOrders`), so the
// two can't drift apart. Inside the caller's transaction it locks the order, checks the change
// against the lifecycle rules (`nextOrderState`), writes the patch and its timestamps, records the
// new status in `order_status_history`, queues the customer's status emails (#138: shipped,
// arrived, cancelled, refunded; sent after the commit or by `pnpm db:send-order-emails`) and,
// when the order is cancelled or comes back unclaimed, puts its units back in stock and what a
// gift card paid back on the card, queuing those products and cards for Strapi. A refused change
// writes nothing.
//
// It must not import `db/index.ts`: the job runs from the CLI without the web app's env.
import type { OrderStatusSource } from "~/lib/enums";
import {
  type NextOrderState,
  nextOrderState,
  type OrderLifecyclePatch,
  type OrderStatusChange,
} from "~/lib/order-status";
import { orderStatusEmailTypes } from "~/lib/order-status-emails";
import type { Db } from "../db/client";
import { enqueueCmsSync } from "../db/queries/cms-outbox";
import { restoreGiftCardRedemptions } from "../db/queries/gift-cards";
import { queueOrderStatusEmails } from "../db/queries/order-emails";
import { insertOrderStatusHistory } from "../db/queries/order-status-history";
import { lockOrderLifecycle, restockOrder, updateOrderLifecycle } from "../db/queries/orders";

/** A transaction (or `Db`) the change runs in. */
type Executor = Pick<Db, "select" | "insert" | "update" | "delete" | "execute">;

export type ChangeOrderStatusResult =
  /** `emailsQueued`: status emails were queued (#138), to send after the commit. */
  | { ok: true; patch: OrderLifecyclePatch; emailsQueued: boolean }
  | { ok: false; error: "unknown-order" }
  | Extract<NextOrderState, { ok: false }>;

/** Applies `change` to the order under its row lock; see the module comment. */
export async function changeOrderStatus(
  tx: Executor,
  orderId: number,
  change: OrderStatusChange,
  { source, now }: { source: OrderStatusSource; now: Date },
): Promise<ChangeOrderStatusResult> {
  const current = await lockOrderLifecycle(tx, orderId);
  if (!current) {
    return { ok: false, error: "unknown-order" };
  }
  const next = nextOrderState(current, change, now);
  if (!next.ok) {
    return next;
  }
  await updateOrderLifecycle(tx, orderId, next.patch);
  if (next.patch.status !== undefined) {
    await insertOrderStatusHistory(tx, {
      orderId,
      status: next.patch.status,
      source,
      changedAt: now,
    });
  }
  // The customer hears about it once per type, in the same transaction (#138).
  const emailsQueued = await queueOrderStatusEmails(tx, orderId, orderStatusEmailTypes(next.patch));
  if (next.restock) {
    await enqueueCmsSync(tx, "product", await restockOrder(tx, orderId));
    // What a gift card paid goes back on it, like the units go back in stock (#125).
    await enqueueCmsSync(tx, "gift_card", await restoreGiftCardRedemptions(tx, orderId, now));
  }
  return { ok: true, patch: next.patch, emailsQueued: emailsQueued.length > 0 };
}
