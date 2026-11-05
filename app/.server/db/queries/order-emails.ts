// The order email outbox (#45). Rows are queued in the order's transaction, then claimed, sent
// and marked by `services/order-email.ts`.
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import type { OrderEmailType } from "~/lib/enums";
import type { Locale } from "~/lib/i18n";
import type { Db } from "../client";
import { orderEmails } from "../schema";

/** A `Db` or a transaction, so the order service can pass `tx` down. */
type Executor = Pick<Db, "select" | "insert" | "update">;

/**
 * Queues an email for the order (or the gift card, #125); call it inside the transaction that
 * placed the order or activated the card.
 */
export async function insertOrderEmail(
  db: Executor,
  email: ({ orderId: number } | { giftCardId: number }) & { type: OrderEmailType; locale: Locale },
): Promise<void> {
  await db.insert(orderEmails).values(email);
}

/** A row this sender now holds until its `next_attempt_at`. `attempts` includes this one. */
export interface ClaimedOrderEmail {
  id: number;
  /** The order's email; `null` for a gift card's. */
  orderId: number | null;
  /** The gift card's email (#125); `null` for an order's. */
  giftCardId: number | null;
  type: OrderEmailType;
  locale: Locale;
  attempts: number;
}

export interface ClaimOptions {
  /** Only this order's emails (the attempt right after checkout). */
  orderId?: number;
  /** Only this gift card's emails (the attempt right after its payment, #125). */
  giftCardId?: number;
  limit: number;
  /**
   * Minutes to wait before retrying after attempt 1, 2, …; the last value repeats. Whole
   * positive numbers.
   */
  retryDelaysMinutes: readonly number[];
}

/**
 * Claims up to `limit` due `pending` emails, oldest first: counts the attempt and moves
 * `next_attempt_at` to when it may be retried. Rows another sender is claiming are skipped
 * (`SKIP LOCKED`), and a claimed row isn't due again until its retry time, so concurrent senders
 * never get the same row. If this sender dies before marking the row, it is retried then.
 */
export function claimOrderEmails(
  db: Executor,
  { orderId, giftCardId, limit, retryDelaysMinutes }: ClaimOptions,
): Promise<ClaimedOrderEmail[]> {
  const delays = retryDelaysMinutes.map((minutes) => {
    if (!Number.isInteger(minutes) || minutes <= 0) {
      throw new Error(`Retry delays must be whole positive minutes, got ${minutes}`);
    }
    return minutes;
  });
  if (delays.length === 0) {
    throw new Error("At least one retry delay is required");
  }
  const due = db
    .select({ id: orderEmails.id })
    .from(orderEmails)
    .where(
      and(
        eq(orderEmails.status, "pending"),
        lte(orderEmails.nextAttemptAt, sql`now()`),
        orderId === undefined ? undefined : eq(orderEmails.orderId, orderId),
        giftCardId === undefined ? undefined : eq(orderEmails.giftCardId, giftCardId),
      ),
    )
    .orderBy(asc(orderEmails.nextAttemptAt), asc(orderEmails.id))
    .limit(limit)
    .for("update", { skipLocked: true });
  // `attempts` on the right-hand side is the value before this claim; arrays are 1-based.
  return db
    .update(orderEmails)
    .set({
      attempts: sql`${orderEmails.attempts} + 1`,
      nextAttemptAt: sql`now() + make_interval(mins => (${`{${delays.join(",")}}`}::int[])[least(${orderEmails.attempts} + 1, ${delays.length})])`,
    })
    .where(inArray(orderEmails.id, due))
    .returning({
      id: orderEmails.id,
      orderId: orderEmails.orderId,
      giftCardId: orderEmails.giftCardId,
      type: orderEmails.type,
      locale: orderEmails.locale,
      attempts: orderEmails.attempts,
    });
}

/** The email went out. */
export async function markOrderEmailSent(db: Executor, id: number): Promise<void> {
  await db
    .update(orderEmails)
    .set({ status: "sent", sentAt: sql`now()`, lastError: null })
    .where(eq(orderEmails.id, id));
}

/**
 * Sending failed: keeps the error and, when `final`, stops retrying (`failed`). Otherwise the row
 * stays `pending` and is due again at the retry time its claim set.
 */
export async function markOrderEmailFailed(
  db: Executor,
  id: number,
  { error, final }: { error: string; final: boolean },
): Promise<void> {
  await db
    .update(orderEmails)
    .set({ lastError: error, ...(final ? { status: "failed" as const } : {}) })
    .where(eq(orderEmails.id, id));
}
