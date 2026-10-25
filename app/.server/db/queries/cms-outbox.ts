// The Strapi sync outbox (#40). Rows are queued in the transaction that changed an order or a
// product, then claimed, pushed and marked by `services/cms-sync.ts`.
import { and, asc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import type { CmsSyncEntity } from "~/lib/enums";
import type { Db } from "../client";
import { cmsOutbox, orders, products } from "../schema";

/** A `Db` or a transaction, so services can pass `tx` down. */
type Executor = Pick<Db, "select" | "insert" | "update">;

/**
 * Queues a push of these orders or products; call it inside the transaction that changed them.
 * An entity that is already queued (or was synced before) is due again now, with a new
 * `version` and a fresh attempt count.
 */
export async function enqueueCmsSync(
  db: Executor,
  entity: CmsSyncEntity,
  entityIds: readonly number[],
): Promise<void> {
  const ids = [...new Set(entityIds)];
  if (ids.length === 0) return;
  await db
    .insert(cmsOutbox)
    .values(ids.map((entityId) => ({ entity, entityId })))
    .onConflictDoUpdate({
      target: [cmsOutbox.entity, cmsOutbox.entityId],
      set: {
        version: sql`${cmsOutbox.version} + 1`,
        attempts: 0,
        nextAttemptAt: sql`now()`,
        lastError: null,
        syncedAt: null,
      },
    });
}

/** Queues every product and every order, for the first sync of an existing database. */
export async function enqueueAllForCmsSync(db: Executor): Promise<void> {
  const [productIds, orderIds] = await Promise.all([
    db.select({ id: products.id }).from(products),
    db.select({ id: orders.id }).from(orders),
  ]);
  await enqueueCmsSync(
    db,
    "product",
    productIds.map((row) => row.id),
  );
  await enqueueCmsSync(
    db,
    "order",
    orderIds.map((row) => row.id),
  );
}

/** A row this sender now holds until its `next_attempt_at`. `attempts` includes this one. */
export interface ClaimedCmsSync {
  id: number;
  entity: CmsSyncEntity;
  entityId: number;
  version: number;
  attempts: number;
}

export interface ClaimCmsSyncOptions {
  /** Only these entities (the push right after a change). */
  only?: { entity: CmsSyncEntity; ids: readonly number[] }[];
  limit: number;
  /** Minutes to wait before retrying after attempt 1, 2, …; the last value repeats. */
  retryDelaysMinutes: readonly number[];
}

/**
 * Claims up to `limit` due rows, oldest first, counting the attempt and moving
 * `next_attempt_at` to the retry time, like `claimOrderEmails`. Rows another sender is claiming
 * are skipped, so concurrent senders never push the same row at once.
 */
export function claimCmsSync(
  db: Executor,
  { only, limit, retryDelaysMinutes }: ClaimCmsSyncOptions,
): Promise<ClaimedCmsSync[]> {
  const delays = retryDelaysMinutes.map((minutes) => {
    if (!Number.isInteger(minutes) || minutes <= 0) {
      throw new Error(`Retry delays must be whole positive minutes, got ${minutes}`);
    }
    return minutes;
  });
  if (delays.length === 0) {
    throw new Error("At least one retry delay is required");
  }
  const filters = only?.filter((group) => group.ids.length > 0);
  if (filters?.length === 0) {
    return Promise.resolve([]);
  }
  const due = db
    .select({ id: cmsOutbox.id })
    .from(cmsOutbox)
    .where(
      and(
        isNull(cmsOutbox.syncedAt),
        lte(cmsOutbox.nextAttemptAt, sql`now()`),
        filters === undefined
          ? undefined
          : sql`(${sql.join(
              filters.map(
                ({ entity, ids }) =>
                  sql`(${cmsOutbox.entity} = ${entity} and ${inArray(cmsOutbox.entityId, [...ids])})`,
              ),
              sql` or `,
            )})`,
      ),
    )
    .orderBy(asc(cmsOutbox.nextAttemptAt), asc(cmsOutbox.id))
    .limit(limit)
    .for("update", { skipLocked: true });
  // `attempts` on the right-hand side is the value before this claim; arrays are 1-based.
  return db
    .update(cmsOutbox)
    .set({
      attempts: sql`${cmsOutbox.attempts} + 1`,
      nextAttemptAt: sql`now() + make_interval(mins => (${`{${delays.join(",")}}`}::int[])[least(${cmsOutbox.attempts} + 1, ${delays.length})])`,
    })
    .where(inArray(cmsOutbox.id, due))
    .returning({
      id: cmsOutbox.id,
      entity: cmsOutbox.entity,
      entityId: cmsOutbox.entityId,
      version: cmsOutbox.version,
      attempts: cmsOutbox.attempts,
    });
}

/**
 * The push of `version` went through. A row queued again since then keeps its newer version
 * and stays due.
 */
export async function markCmsSynced(db: Executor, id: number, version: number): Promise<void> {
  await db
    .update(cmsOutbox)
    .set({ syncedAt: sql`now()`, lastError: null })
    .where(and(eq(cmsOutbox.id, id), eq(cmsOutbox.version, version)));
}

/**
 * The push of `version` failed: keeps the error, and the row is due again at the retry time its
 * claim set. A row queued again since then is already due and keeps no stale error.
 */
export async function markCmsSyncFailed(
  db: Executor,
  id: number,
  version: number,
  error: string,
): Promise<void> {
  await db
    .update(cmsOutbox)
    .set({ lastError: error })
    .where(and(eq(cmsOutbox.id, id), eq(cmsOutbox.version, version)));
}
