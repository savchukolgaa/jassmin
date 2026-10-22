import { existsSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const hasDatabase = Boolean(process.env.JASSMINDB_URI || process.env.DATABASE_URL);

// Integration test: runs only when a database is configured (e.g. Aspire's Postgres is up).
describe.skipIf(!hasDatabase)("getDatabaseInfo", () => {
  afterAll(async () => {
    const { db } = await import("../index");
    await db.$client.end();
  });

  it("returns the database time and PostgreSQL version", async () => {
    const { getDatabaseInfo } = await import("./health");

    const info = await getDatabaseInfo();

    expect(info.serverTime).toBeInstanceOf(Date);
    expect(Number.isNaN(info.serverTime.getTime())).toBe(false);
    expect(info.pgVersion).toContain("PostgreSQL");
  });
});
