import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getEnv } from "../env";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema> & { $client: Pool };

function createDb(): Db {
  const pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 10 });
  return drizzle({ client: pool, schema, casing: "snake_case" });
}

// Reuse one pool across Vite HMR reloads in development instead of leaking connections.
const globalForDb = globalThis as typeof globalThis & { __jassminDb?: Db };

export const db: Db = globalForDb.__jassminDb ?? createDb();

if (getEnv().NODE_ENV !== "production") {
  globalForDb.__jassminDb = db;
}
