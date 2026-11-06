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

/**
 * Queues the order status emails `types` (#138) in the language of the order's confirmation
 * (Ukrainian when it has none); call it inside the transaction that changed the order. A type
 * the order already has (sent, pending or failed) is skipped, so each goes out at most once.
 * Returns the types it queued.
 */
export async function queueOrderStatusEmails(
  db: Pick<Db, "execute">,
  orderId: number,
  types: readonly OrderEmailType[],
): Promise<OrderEmailType[]> {
  if (types.length === 0) return [];
  const result = await db.execute<{ type: OrderEmailType }>(sql`
    insert into ${orderEmails} (order_id, type, locale)
    select ${orderId}, t.type, coalesce(
      (select locale from ${orderEmails}
        where order_id = ${orderId} and type = 'confirmation'),
      'uk'
    )
    from unnest(${`{${types.join(",")}}`}::text[]) with ordinality as t(type, n)
    order by t.n
    on conflict (order_id, type) do nothing
    returning type`);
  return result.rows.map((row) => row.type);
}

/** A row this sender now holds until its `next_attempt_at`. `attempts` includes this one. */
export interface ClaimedOrderEmail {
  id: number;
  /** The order's email; `null` for a gift card's. */
  orderId: number | null;
  /** The gift card's email (#125); `null` for an order's. */
  giftCardId: number | null;
  /** The abandoned cart's reminder (#139); `null` for every other email. */
  cartId: number | null;
  type: OrderEmailType;
  locale: Locale;
  attempts: number;
}

export interface ClaimOptions {
  /** Only this order's emails (the attempt right after checkout). */
  orderId?: number;
  /** Only this gift card's emails (the attempt right after its payment, #125). */
  giftCardId?: number;
  /** Only emails of this type (the cart reminder job sends its own right away, #139). */
  type?: OrderEmailType;
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
  { orderId, giftCardId, type, limit, retryDelaysMinutes }: ClaimOptions,
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
        type === undefined ? undefined : eq(orderEmails.type, type),
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
      cartId: orderEmails.cartId,
      type: orderEmails.type,
      locale: orderEmails.locale,
      attempts: orderEmails.attempts,
    });
}

/** The email went out, with this Message-ID (#134; kept to match a later bounce). */
export async function markOrderEmailSent(
  db: Executor,
  id: number,
  messageId: string | null = null,
): Promise<void> {
  await db
    .update(orderEmails)
    .set({ status: "sent", sentAt: sql`now()`, lastError: null, messageId })
    .where(eq(orderEmails.id, id));
}

/**
 * A sent email bounced or drew a spam complaint (#134): marks it `failed` with the reason. Matches
 * the row by id (the provider echoes the tag we sent) or by its Message-ID, and only touches a
 * `sent` row. Returns how many rows changed (0 when nothing matched).
 */
export async function markOrderEmailBounced(
  db: Executor,
  { orderEmailId, messageId, error }: { orderEmailId?: number; messageId?: string; error: string },
): Promise<number> {
  const match =
    orderEmailId !== undefined
      ? eq(orderEmails.id, orderEmailId)
      : messageId !== undefined
        ? eq(orderEmails.messageId, messageId)
        : undefined;
  if (!match) return 0;
  const rows = await db
    .update(orderEmails)
    .set({ status: "failed", lastError: error })
    .where(and(match, eq(orderEmails.status, "sent")))
    .returning({ id: orderEmails.id });
  return rows.length;
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
