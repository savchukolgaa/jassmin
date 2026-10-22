import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { z } from "zod";
import type { Db } from "./client";

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations/", import.meta.url));
const ROLLBACKS_DIR = fileURLToPath(new URL("./rollbacks/", import.meta.url));

/** Drizzle's migrations table (drizzle-kit and `migrate()` default). */
const MIGRATIONS_TABLE = "drizzle.__drizzle_migrations";

const journalSchema = z.object({
  entries: z.array(z.object({ tag: z.string(), when: z.number() })),
});

/** Applies all pending migrations, like `pnpm db:migrate`. */
export async function migrateLatest(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
}

/**
 * Rolls back the most recently applied migration by running its hand-written
 * `rollbacks/<tag>.sql` and removing it from Drizzle's migrations table, in one transaction.
 * Returns the rolled-back tag, or `null` when no migration is applied.
 */
export async function rollbackLatest(db: Db): Promise<string | null> {
  const journal = journalSchema.parse(
    JSON.parse(await readFile(`${MIGRATIONS_DIR}meta/_journal.json`, "utf8")),
  );

  return db.transaction(async (tx) => {
    const exists = await tx.execute<{ regclass: string | null }>(
      sql`select to_regclass(${MIGRATIONS_TABLE}) as regclass`,
    );
    if (!exists.rows[0]?.regclass) {
      return null;
    }

    // `created_at` is the journal entry's `when` (a bigint, returned as a string).
    const latest = await tx.execute<{ id: number; created_at: string }>(
      sql`select id, created_at from drizzle.__drizzle_migrations order by created_at desc limit 1`,
    );
    const row = latest.rows[0];
    if (!row) {
      return null;
    }

    const entry = journal.entries.find((e) => e.when === Number(row.created_at));
    if (!entry) {
      throw new Error(`No journal entry for the applied migration created at ${row.created_at}`);
    }

    const downFile = `${ROLLBACKS_DIR}${entry.tag}.sql`;
    const downSql = await readFile(downFile, "utf8").catch((error: unknown) => {
      throw new Error(`Missing rollback file for ${entry.tag}: ${downFile}`, { cause: error });
    });

    for (const statement of downSql.split("--> statement-breakpoint")) {
      if (statement.trim()) {
        await tx.execute(sql.raw(statement));
      }
    }
    await tx.execute(sql`delete from drizzle.__drizzle_migrations where id = ${row.id}`);

    return entry.tag;
  });
}
