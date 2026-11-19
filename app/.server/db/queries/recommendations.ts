// Product recommendations (#182): the signals `pnpm db:build-recommendations` reads, the table it
// writes, and the storefront's reads of it.
import { and, desc, eq, inArray, isNotNull, or, type SQL, sql } from "drizzle-orm";
import type { Db } from "../client";
import { orderItems, orders, productRecommendations, userEvents } from "../schema";
import { SOLD_ORDER_STATUSES } from "./products";

/** Purchases count three times as much as views (#182). */
export const PURCHASE_WEIGHT = 3;
export const VIEW_WEIGHT = 1;

/**
 * One product in one "basket": a customer's sold orders (`c:<user id>` or `c:<guest email>`) or
 * an analytics session's product views (`s:<session id>`), with the basket's weight.
 */
export interface RecommendationSignal {
  basket: string;
  productId: number;
  weight: number;
}

/**
 * Every (basket, product) pair since `since`, each once: products in a customer's paid, shipped
 * or completed orders (weight 3) and products viewed in the same session (weight 1). Views exist
 * only with consent (`trackEvent`), so no extra check is needed.
 */
export async function listRecommendationSignals(
  db: Pick<Db, "execute">,
  since: Date,
): Promise<RecommendationSignal[]> {
  const statuses = sql.join(
    SOLD_ORDER_STATUSES.map((status) => sql`${status}`),
    sql`, `,
  );
  const result = await db.execute<{ basket: string; product_id: number; weight: number }>(sql`
    select distinct
      'c:' || coalesce(o.user_id::text, lower(o.guest_email)) as basket,
      oi.product_id,
      ${PURCHASE_WEIGHT}::int as weight
    from order_items oi
    join orders o on o.id = oi.order_id
    where oi.product_id is not null
      and o.status in (${statuses})
      and o.created_at >= ${since}
    union all
    select distinct
      's:' || e.session_id::text as basket,
      e.product_id,
      ${VIEW_WEIGHT}::int as weight
    from user_events e
    where e.event_type = 'product_view'
      and e.product_id is not null
      and e.created_at >= ${since}
  `);
  return result.rows.map((row) => ({
    basket: row.basket,
    productId: Number(row.product_id),
    weight: Number(row.weight),
  }));
}

export type NewProductRecommendation = typeof productRecommendations.$inferInsert;

const INSERT_CHUNK = 1000;

/** Replaces the whole table with `rows`. Call it inside a transaction. */
export async function replaceRecommendations(
  tx: Pick<Db, "delete" | "insert">,
  rows: readonly NewProductRecommendation[],
): Promise<void> {
  await tx.delete(productRecommendations);
  for (let start = 0; start < rows.length; start += INSERT_CHUNK) {
    await tx.insert(productRecommendations).values(rows.slice(start, start + INSERT_CHUNK));
  }
}

/**
 * The products a visitor viewed most recently (`products.id`, latest first), by their user id or
 * their `anonymous_id` cookie. Views exist only with consent; call it only when tracking is
 * allowed for this request.
 */
export async function listRecentlyViewedProductIds(
  db: Pick<Db, "select">,
  {
    userId,
    anonymousId,
    limit,
  }: { userId: number | null; anonymousId: string | null; limit: number },
): Promise<number[]> {
  const visitor: SQL[] = [];
  if (userId !== null) {
    visitor.push(eq(userEvents.userId, userId));
  }
  if (anonymousId) {
    visitor.push(eq(userEvents.anonymousId, anonymousId));
  }
  if (visitor.length === 0) {
    return [];
  }
  const rows = await db
    .select({ productId: userEvents.productId })
    .from(userEvents)
    .where(
      and(
        eq(userEvents.eventType, "product_view"),
        isNotNull(userEvents.productId),
        or(...visitor),
      ),
    )
    .groupBy(userEvents.productId)
    .orderBy(desc(sql`max(${userEvents.createdAt})`))
    .limit(limit);
  return rows.flatMap((row) => (row.productId === null ? [] : [row.productId]));
}

/**
 * Every product a user has ordered (`products.id`, latest order first): sold orders and pending
 * ones, so a just-placed order isn't suggested again; cancelled and returned ones don't count.
 */
export async function listPurchasedProductIds(
  db: Pick<Db, "select">,
  userId: number,
): Promise<number[]> {
  const rows = await db
    .select({ productId: orderItems.productId })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(
      and(
        eq(orders.userId, userId),
        isNotNull(orderItems.productId),
        inArray(orders.status, [...SOLD_ORDER_STATUSES, "pending"]),
      ),
    )
    .groupBy(orderItems.productId)
    .orderBy(desc(sql`max(${orders.createdAt})`));
  return rows.flatMap((row) => (row.productId === null ? [] : [row.productId]));
}
