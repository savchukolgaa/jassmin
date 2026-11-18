// Creates the databases a fresh production server needs (#176): the Compose deployment's Postgres
// starts empty, and unlike `pnpm aspire run`, Aspire doesn't create `jassmindb` and `strapidb` there.
// `db-migrate` runs this before the migrations on every deploy; a second run changes nothing.
import { setTimeout as sleep } from "node:timers/promises";
import { Client } from "pg";

/** Database names this creates: plain lowercase identifiers, so they never need escaping rules. */
const DATABASE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

export interface CreateDatabasesOptions {
  /** Connection attempts while Postgres is still starting (Compose can't wait for its health). */
  attempts?: number;
  delayMs?: number;
  log?: (message: string) => void;
}

/** The same server's maintenance database (`postgres`), to run `CREATE DATABASE` from. */
export function maintenanceUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  url.pathname = "/postgres";
  return url.toString();
}

async function connect(url: string, attempts: number, delayMs: number): Promise<Client> {
  for (let attempt = 1; ; attempt++) {
    const client = new Client({ connectionString: url });
    try {
      await client.connect();
      return client;
    } catch (error) {
      await client.end().catch(() => {});
      if (attempt >= attempts) {
        throw error;
      }
      await sleep(delayMs);
    }
  }
}

/**
 * Creates each database in `names` that doesn't exist yet on the server of `databaseUrl`, and
 * returns the ones it created. Throws for a name that isn't a plain lowercase identifier.
 */
export async function createDatabases(
  databaseUrl: string,
  names: readonly string[],
  { attempts = 30, delayMs = 2000, log = console.log }: CreateDatabasesOptions = {},
): Promise<string[]> {
  for (const name of names) {
    if (!DATABASE_NAME.test(name)) {
      throw new Error(`Not a database name this creates: ${JSON.stringify(name)}`);
    }
  }
  const client = await connect(maintenanceUrl(databaseUrl), attempts, delayMs);
  const created: string[] = [];
  try {
    for (const name of names) {
      const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [
        name,
      ]);
      if (rowCount) {
        log(`Database ${name} exists.`);
        continue;
      }
      // Checked against DATABASE_NAME above; CREATE DATABASE can't take a parameter.
      await client.query(`CREATE DATABASE "${name}"`);
      created.push(name);
      log(`Created database ${name}.`);
    }
  } finally {
    await client.end();
  }
  return created;
}
