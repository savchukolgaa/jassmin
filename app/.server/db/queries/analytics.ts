import { and, eq } from "drizzle-orm";
import type { Db } from "../client";
import { sessions } from "../schema";

/** Whether the analytics session exists and belongs to this visitor. */
export async function hasVisitorSession(
  db: Db,
  sessionId: string,
  anonymousId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ sessionId: sessions.sessionId })
    .from(sessions)
    .where(and(eq(sessions.sessionId, sessionId), eq(sessions.anonymousId, anonymousId)))
    .limit(1);
  return row !== undefined;
}

/** Starts an analytics session for the visitor and returns its id. */
export async function insertSession(
  db: Db,
  values: { anonymousId: string; landingPage: string },
): Promise<string> {
  const [row] = await db
    .insert(sessions)
    .values(values)
    .returning({ sessionId: sessions.sessionId });
  if (!row) throw new Error("Inserting a session returned no row");
  return row.sessionId;
}
