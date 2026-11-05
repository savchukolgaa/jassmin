// Fixed-window rate-limit counters (#143), shared by every app instance. `rate-limit.ts` builds
// the limiters on top of these; keys arrive already hashed.
import { eq, lt, sql } from "drizzle-orm";
import type { Db } from "../client";
import { rateLimits } from "../schema";

export interface RateLimitWindow {
  count: number;
  resetAt: Date;
}

/**
 * Counts one hit for `key` and returns its window. A new key, or one whose window ended by `now`,
 * starts a fresh window of `windowMs` with count 1. One statement, so concurrent hits on the same
 * key wait for each other's row lock and are all counted.
 */
export async function hitRateLimit(
  db: Pick<Db, "insert">,
  key: string,
  windowMs: number,
  now: Date,
): Promise<RateLimitWindow> {
  const resetAt = new Date(now.getTime() + windowMs);
  const expired = sql`${rateLimits.resetAt} <= ${now}`;
  const [row] = await db
    .insert(rateLimits)
    .values({ key, count: 1, resetAt })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`case when ${expired} then 1 else ${rateLimits.count} + 1 end`,
        resetAt: sql`case when ${expired} then excluded.reset_at else ${rateLimits.resetAt} end`,
      },
    })
    .returning({ count: rateLimits.count, resetAt: rateLimits.resetAt });
  if (!row) {
    throw new Error(`Counting a hit for rate limit ${key} returned no row`);
  }
  return row;
}

/** `key`'s current window, or `undefined` when it has none. It may have ended already. */
export async function readRateLimit(
  db: Pick<Db, "select">,
  key: string,
): Promise<RateLimitWindow | undefined> {
  const [row] = await db
    .select({ count: rateLimits.count, resetAt: rateLimits.resetAt })
    .from(rateLimits)
    .where(eq(rateLimits.key, key));
  return row;
}

/** Forgets `key`'s hits. */
export async function deleteRateLimit(db: Pick<Db, "delete">, key: string): Promise<void> {
  await db.delete(rateLimits).where(eq(rateLimits.key, key));
}

/** Deletes every window that ended before `now`; returns how many. */
export async function pruneRateLimits(db: Pick<Db, "delete">, now: Date): Promise<number> {
  const rows = await db
    .delete(rateLimits)
    .where(lt(rateLimits.resetAt, now))
    .returning({ key: rateLimits.key });
  return rows.length;
}
