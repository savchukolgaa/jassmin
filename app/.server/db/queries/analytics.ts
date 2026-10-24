import { and, eq, isNull, sql } from "drizzle-orm";
import { SESSION_TIMEOUT_MINUTES } from "~/lib/analytics";
import type { Db } from "../client";
import { sessions, userEvents } from "../schema";

/** A `Db` or a transaction, so `linkVisitorToUser` can pass `tx` down. */
type Executor = Pick<Db, "update" | "execute">;

/** The attribution columns of a session, as `touchActiveSession` returns them. */
export interface SessionAttribution {
  trafficSource: string | null;
  trafficMedium: string | null;
  trafficCampaign: string | null;
}

/**
 * Marks the visitor's session as active now and returns its attribution, or `undefined` when the
 * session doesn't exist, belongs to another visitor or timed out (no request for
 * `SESSION_TIMEOUT_MINUTES`). `ended_at` holds the time of the last request.
 */
export async function touchActiveSession(
  db: Db,
  sessionId: string,
  anonymousId: string,
): Promise<SessionAttribution | undefined> {
  const [row] = await db
    .update(sessions)
    .set({ endedAt: sql`now()` })
    .where(
      and(
        eq(sessions.sessionId, sessionId),
        eq(sessions.anonymousId, anonymousId),
        sql`coalesce(${sessions.endedAt}, ${sessions.startedAt}) >
          now() - make_interval(mins => ${SESSION_TIMEOUT_MINUTES})`,
      ),
    )
    .returning({
      trafficSource: sessions.trafficSource,
      trafficMedium: sessions.trafficMedium,
      trafficCampaign: sessions.trafficCampaign,
    });
  return row;
}

/** Starts an analytics session for the visitor and returns its id. */
export async function insertSession(
  db: Db,
  values: Omit<typeof sessions.$inferInsert, "sessionId" | "startedAt" | "endedAt">,
): Promise<string> {
  const [row] = await db
    .insert(sessions)
    .values(values)
    .returning({ sessionId: sessions.sessionId });
  if (!row) throw new Error("Inserting a session returned no row");
  return row.sessionId;
}

export type NewUserEvent = Omit<typeof userEvents.$inferInsert, "eventId" | "createdAt">;

/** Records behavioural events in one statement. */
export async function insertEvents(db: Db, rows: NewUserEvent[]): Promise<void> {
  if (rows.length === 0) {
    return;
  }
  await db.insert(userEvents).values(rows);
}

/** Gives the visitor's anonymous sessions and events to the user who just logged in. */
export async function linkAnonymousRows(
  db: Executor,
  anonymousId: string,
  userId: number,
): Promise<void> {
  await db
    .update(sessions)
    .set({ userId })
    .where(and(eq(sessions.anonymousId, anonymousId), isNull(sessions.userId)));
  await db
    .update(userEvents)
    .set({ userId })
    .where(and(eq(userEvents.anonymousId, anonymousId), isNull(userEvents.userId)));
}

/**
 * Sets the user's first-touch attribution from the visitor's earliest attributed session, unless
 * the user already has one.
 */
export async function fillFirstTouch(
  db: Executor,
  anonymousId: string,
  userId: number,
): Promise<void> {
  await db.execute(sql`
    update users
    set first_touch_source = earliest.traffic_source,
      first_touch_medium = earliest.traffic_medium,
      first_touch_campaign = earliest.traffic_campaign
    from (
      select traffic_source, traffic_medium, traffic_campaign
      from sessions
      where anonymous_id = ${anonymousId} and traffic_source is not null
      order by started_at
      limit 1
    ) as earliest
    where users.id = ${userId} and users.first_touch_source is null
  `);
}
