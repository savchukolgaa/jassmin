import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema> & { $client: Pool };

/**
 * Creates a Drizzle client with its own pool. The app uses the `db` singleton from `./index`;
 * this factory is for CLI scripts and tests that connect to a specific database. Close the
 * pool with `db.$client.end()` when done.
 */
export function createDb(connectionString: string, max = 10): Db {
  const pool = new Pool({ connectionString, max });
  return drizzle({ client: pool, schema, casing: "snake_case" });
}
