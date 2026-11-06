// Abandoned-cart reminders (#139): who gets one, queuing it in the `order_emails` outbox, what the
// email shows, and the cart a reminded user can restore from `/koshyk`.
import { and, asc, desc, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import type { Db } from "../client";
import {
  cartItems,
  carts,
  emailSuppressions,
  orderEmails,
  orders,
  products,
  productVariants,
  users,
} from "../schema";
import { availableStock } from "./products";

/** A `Db` or a transaction. */
type Executor = Pick<Db, "select" | "insert" | "update" | "delete" | "execute">;

/** Only carts abandoned this recently get a reminder, so old carts are never dug up. */
export const CART_REMINDER_MAX_AGE_HOURS = 72;

/** At most one reminder per user in this many days, and how long a reminded cart can be restored. */
export const CART_REMINDER_INTERVAL_DAYS = 7;

/** Reminders queued per job run at most; the next hourly run takes the rest. */
export const CART_REMINDER_BATCH_SIZE = 100;

/** The lines a reminder lists; "and N more" stands for the rest. */
export const CART_REMINDER_MAX_LINES = 3;

/** A line the shop can still sell: an active product, and a size with stock or untracked (#98). */
const isAvailable = sql`${availableStock} > 0`;

export interface QueueCartRemindersOptions {
  maxAgeHours?: number;
  intervalDays?: number;
  limit?: number;
}

/**
 * Queues the reminder of every eligible abandoned cart, in one statement, and returns the queued
 * cart ids. Eligible: an `abandoned` cart of a registered user, abandoned in the last
 * `maxAgeHours` and not reminded yet, whose user agreed to marketing email, isn't suppressed, had
 * no reminder in the last `intervalDays`, hasn't ordered since the cart's last activity, isn't
 * shopping in a newer active cart, and has at least one line that is still available. Only each
 * user's latest such cart counts.
 *
 * It sets `reminder_sent_at` (keeping `updated_at`, the shopper's last activity) and inserts the
 * `cart_reminder` row in the user's language. A concurrent run can't queue a cart twice: the
 * update only takes carts still without `reminder_sent_at`, and the outbox allows one reminder per
 * cart.
 */
export async function queueCartReminders(
  db: Pick<Db, "execute">,
  {
    maxAgeHours = CART_REMINDER_MAX_AGE_HOURS,
    intervalDays = CART_REMINDER_INTERVAL_DAYS,
    limit = CART_REMINDER_BATCH_SIZE,
  }: QueueCartRemindersOptions = {},
): Promise<number[]> {
  const result = await db.execute<{ cart_id: number }>(sql`
    with candidates as (
      select distinct on (c.user_id) c.id, c.user_id
      from carts c
      join users u on u.id = c.user_id
      where c.status = 'abandoned'
        and c.reminder_sent_at is null
        and c.abandoned_at >= now() - make_interval(hours => ${maxAgeHours})
        and u.marketing_opt_in
        and not exists (
          select 1 from email_suppressions s where s.address = lower(u.email))
        and not exists (
          select 1 from carts r
          where r.user_id = c.user_id
            and r.reminder_sent_at > now() - make_interval(days => ${intervalDays}))
        and not exists (
          select 1 from orders o where o.user_id = c.user_id and o.created_at > c.updated_at)
        and not exists (
          select 1 from carts a
          where a.user_id = c.user_id and a.status = 'active' and a.updated_at > c.abandoned_at
            and exists (select 1 from cart_items ai where ai.cart_id = a.id))
        and exists (
          select 1 from cart_items ci
          join product_variants v on v.id = ci.variant_id
          join products p on p.id = ci.product_id
          where ci.cart_id = c.id
            and p.active
            and (not v.track_stock or v.stock_quantity > 0))
      order by c.user_id, c.abandoned_at desc, c.id desc
    ),
    picked as (
      select id, user_id from candidates order by id limit ${limit}
    ),
    marked as (
      update carts
      set reminder_sent_at = now(), updated_at = carts.updated_at
      from picked
      where carts.id = picked.id and carts.reminder_sent_at is null
      returning carts.id, carts.user_id
    )
    insert into order_emails (cart_id, type, locale)
    select m.id, 'cart_reminder', coalesce(
      u.locale,
      (select e.locale from order_emails e
        join orders o on o.id = e.order_id
        where o.user_id = m.user_id
        order by e.created_at desc, e.id desc
        limit 1),
      'uk')
    from marked m
    join users u on u.id = m.user_id
    on conflict do nothing
    returning cart_id`);
  return result.rows.map((row) => Number(row.cart_id));
}

/** One line as the reminder shows it. */
export interface CartReminderLine {
  title: string;
  brand: string;
  imageUrl: string | null;
  volumeMl: number;
  packSize: number;
  quantity: number;
}

/** What a reminder email needs, read when it is sent. */
export interface CartReminder {
  cartId: number;
  userId: number;
  fullName: string;
  email: string;
  marketingOptIn: boolean;
  /** The address bounced or complained (#134); the sender drops it too. */
  suppressed: boolean;
  /** The user placed an order after the cart's last activity. */
  orderedSince: boolean;
  /** Up to `CART_REMINDER_MAX_LINES` available lines, oldest first. */
  lines: CartReminderLine[];
  /** All available lines. */
  availableLineCount: number;
  /** The available lines' total at today's prices, as exact decimals. */
  subtotal: string;
}

/** The reminder for an abandoned cart of a registered user, or `undefined` if there is none. */
export async function findCartReminder(
  db: Executor,
  cartId: number,
): Promise<CartReminder | undefined> {
  const [cart] = await db
    .select({
      cartId: carts.id,
      userId: users.id,
      fullName: users.fullName,
      email: users.email,
      marketingOptIn: users.marketingOptIn,
      updatedAt: carts.updatedAt,
      suppressed: sql<boolean>`exists (select 1 from ${emailSuppressions}
        where ${emailSuppressions.address} = lower(${users.email}))`,
      orderedSince: sql<boolean>`exists (select 1 from ${orders}
        where ${orders.userId} = ${users.id} and ${orders.createdAt} > ${carts.updatedAt})`,
    })
    .from(carts)
    .innerJoin(users, eq(users.id, carts.userId))
    .where(and(eq(carts.id, cartId), eq(carts.status, "abandoned")));
  if (!cart) {
    return undefined;
  }
  const available = and(eq(cartItems.cartId, cartId), isAvailable);
  const lines = await db
    .select({
      title: products.title,
      brand: products.brand,
      imageUrl: products.imageUrl,
      volumeMl: productVariants.volumeMl,
      packSize: products.packSize,
      quantity: cartItems.quantity,
    })
    .from(cartItems)
    .innerJoin(productVariants, eq(productVariants.id, cartItems.variantId))
    .innerJoin(products, eq(products.id, cartItems.productId))
    .where(available)
    .orderBy(asc(cartItems.addedAt), asc(cartItems.id))
    .limit(CART_REMINDER_MAX_LINES);
  const [totals] = await db
    .select({
      lineCount: sql<number>`count(*)::int`,
      subtotal: sql<string>`coalesce(sum(${productVariants.price} * ${cartItems.quantity}), 0)::numeric(10, 2)`,
    })
    .from(cartItems)
    .innerJoin(productVariants, eq(productVariants.id, cartItems.variantId))
    .innerJoin(products, eq(products.id, cartItems.productId))
    .where(available);
  const { updatedAt: _, ...rest } = cart;
  return {
    ...rest,
    lines,
    availableLineCount: totals?.lineCount ?? 0,
    subtotal: totals?.subtotal ?? "0.00",
  };
}

/** A reminded cart the user can still restore, as the cart page's banner shows it. */
export interface RestorableCart {
  cartId: number;
  abandonedAt: Date;
  /** Units in the cart's available lines. */
  itemCount: number;
}

/**
 * The user's latest abandoned cart that was reminded in the last `CART_REMINDER_INTERVAL_DAYS`,
 * isn't restored yet, still has available lines, and hasn't been followed by an order.
 */
export async function findRestorableCart(
  db: Executor,
  userId: number,
): Promise<RestorableCart | undefined> {
  const [row] = await db
    .select({
      cartId: carts.id,
      abandonedAt: carts.abandonedAt,
      // Plain SQL with aliases: a one-table select leaves Drizzle's column names unqualified.
      // Available: as `availableStock`, an active product and a size with stock or untracked.
      itemCount: sql<number>`(select coalesce(sum(ci.quantity), 0)::int
        from cart_items ci
        join product_variants v on v.id = ci.variant_id
        join products p on p.id = ci.product_id
        where ci.cart_id = "carts"."id"
          and p.active and (not v.track_stock or v.stock_quantity > 0))`,
    })
    .from(carts)
    .where(
      and(
        eq(carts.userId, userId),
        eq(carts.status, "abandoned"),
        isNull(carts.restoredAt),
        isNotNull(carts.abandonedAt),
        gt(
          carts.reminderSentAt,
          sql`now() - make_interval(days => ${CART_REMINDER_INTERVAL_DAYS})`,
        ),
        sql`not exists (select 1 from ${orders}
          where ${orders.userId} = ${userId} and ${orders.createdAt} > ${carts.updatedAt})`,
      ),
    )
    .orderBy(desc(carts.reminderSentAt), desc(carts.id))
    .limit(1);
  if (!row?.abandonedAt || row.itemCount <= 0) {
    return undefined;
  }
  return { cartId: row.cartId, abandonedAt: row.abandonedAt, itemCount: row.itemCount };
}

/**
 * Records that the user restored this cart (#139). Keeps `updated_at` (the shopper's last
 * activity in it) and the `abandoned` status. Returns whether this call did it.
 */
export async function markCartRestored(db: Executor, cartId: number): Promise<boolean> {
  const rows = await db
    .update(carts)
    .set({ restoredAt: sql`now()`, updatedAt: sql`${carts.updatedAt}` })
    .where(and(eq(carts.id, cartId), isNull(carts.restoredAt)))
    .returning({ id: carts.id });
  return rows.length > 0;
}

/** The cart's `cart_reminder` outbox row, for tests and the recovery report. */
export async function findCartReminderEmail(db: Executor, cartId: number) {
  const [row] = await db
    .select({ id: orderEmails.id, locale: orderEmails.locale, status: orderEmails.status })
    .from(orderEmails)
    .where(and(eq(orderEmails.cartId, cartId), eq(orderEmails.type, "cart_reminder")));
  return row;
}
