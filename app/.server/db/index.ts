import { getEnv } from "../env";
import { createDb, type Db } from "./client";

export type { Db } from "./client";

// Reuse one pool across Vite HMR reloads in development instead of leaking connections.
const globalForDb = globalThis as typeof globalThis & { __jassminDb?: Db };

export const db: Db = globalForDb.__jassminDb ?? createDb(getEnv().DATABASE_URL);

if (getEnv().NODE_ENV !== "production") {
  globalForDb.__jassminDb = db;
}
