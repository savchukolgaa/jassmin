import { sql } from "drizzle-orm";
import { db } from "../index";

export interface DatabaseInfo {
  serverTime: Date;
  pgVersion: string;
}

/** Round-trips to PostgreSQL; used by the placeholder home page until real data exists. */
export async function getDatabaseInfo(): Promise<DatabaseInfo> {
  const result = await db.execute<{ server_time: string; pg_version: string }>(
    sql`select now() as server_time, version() as pg_version`,
  );
  const row = result.rows[0];

  if (!row) {
    throw new Error("Database info query returned no rows");
  }

  // Drizzle's node-postgres driver returns raw timestamptz values as strings.
  return { serverTime: new Date(row.server_time), pgVersion: row.pg_version };
}
