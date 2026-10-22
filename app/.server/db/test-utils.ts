// Helpers for DB integration tests. Each test file gets its own throwaway database on the
// configured server, so migrations and seeds never touch the development data.
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { Client } from "pg";
import { getDatabaseUrl } from "../env";
import { createDb, type Db } from "./client";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

/** The configured server URL, or `undefined` when no database is configured. */
export const serverUrl = getDatabaseUrl(process.env);

export const hasDatabase = Boolean(serverUrl);

export interface TestDatabase {
  db: Db;
  /** Closes the pool and drops the database. */
  drop(): Promise<void>;
}

async function runAdmin(statement: string): Promise<void> {
  const client = new Client({ connectionString: serverUrl });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

/** Creates an empty database next to the configured one and connects to it. */
export async function createTestDatabase(prefix: string): Promise<TestDatabase> {
  if (!serverUrl) {
    throw new Error("No database configured");
  }
  const name = `${prefix}_${randomUUID().replaceAll("-", "")}`;
  await runAdmin(`create database "${name}"`);

  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  const db = createDb(url.toString(), 2);

  return {
    db,
    async drop() {
      await db.$client.end();
      await runAdmin(`drop database if exists "${name}" with (force)`);
    },
  };
}

/** The PostgreSQL error code (e.g. `23505`) of a rejected query, unwrapping Drizzle's error. */
export async function pgErrorCode(query: PromiseLike<unknown>): Promise<string | undefined> {
  try {
    await query;
  } catch (error: unknown) {
    const cause = error instanceof Error && error.cause !== undefined ? error.cause : error;
    if (typeof cause === "object" && cause !== null && "code" in cause) {
      return String(cause.code);
    }
    throw error;
  }
  return undefined;
}
