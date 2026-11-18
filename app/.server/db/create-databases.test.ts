import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabases, maintenanceUrl } from "./create-databases";
import { hasDatabase, serverUrl } from "./test-utils";

describe("maintenanceUrl", () => {
  it("points at the same server's postgres database, keeping the credentials", () => {
    expect(maintenanceUrl("postgresql://app:s3cret@postgres:5432/jassmindb?sslmode=disable")).toBe(
      "postgresql://app:s3cret@postgres:5432/postgres?sslmode=disable",
    );
  });
});

describe("createDatabases", () => {
  it("refuses names that aren't plain lowercase identifiers, before connecting", async () => {
    for (const name of ['x"; DROP DATABASE y; --', "Jassmin", "1db", "", "a-b"]) {
      await expect(
        createDatabases("postgresql://nobody@127.0.0.1:1/x", [name], { attempts: 1 }),
      ).rejects.toThrow("Not a database name");
    }
  });

  it("gives up after the last connection attempt", async () => {
    await expect(
      createDatabases("postgresql://nobody@127.0.0.1:1/x", ["db"], { attempts: 2, delayMs: 1 }),
    ).rejects.toThrow();
  });
});

describe.skipIf(!hasDatabase)("createDatabases on PostgreSQL", () => {
  const name = `create_db_test_${randomUUID().replaceAll("-", "").slice(0, 16)}`;

  afterAll(async () => {
    const client = new Client({ connectionString: maintenanceUrl(serverUrl ?? "") });
    await client.connect();
    await client.query(`DROP DATABASE IF EXISTS "${name}"`);
    await client.end();
  });

  it("creates a missing database once, and leaves it alone on the next run", async () => {
    const log = () => {};
    expect(await createDatabases(serverUrl ?? "", [name], { log })).toEqual([name]);
    expect(await createDatabases(serverUrl ?? "", [name], { log })).toEqual([]);
  });
});
