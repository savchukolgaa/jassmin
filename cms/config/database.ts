import type { Core } from "@strapi/strapi";

/**
 * PostgreSQL only. Under Aspire, `DATABASE_URL` is injected for the `strapidb` database;
 * without Aspire, set either `DATABASE_URL` or the discrete `DATABASE_*` variables.
 */
const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Database => {
  const client = env("DATABASE_CLIENT", "postgres");

  if (client !== "postgres") {
    throw new Error(`Unsupported DATABASE_CLIENT: ${client}. Jassmin's CMS uses "postgres".`);
  }

  return {
    connection: {
      client: "postgres",
      connection: {
        connectionString: env("DATABASE_URL"),
        host: env("DATABASE_HOST", "localhost"),
        port: env.int("DATABASE_PORT", 5432),
        database: env("DATABASE_NAME", "strapidb"),
        user: env("DATABASE_USERNAME", "postgres"),
        password: env("DATABASE_PASSWORD", "postgres"),
        ssl: env.bool("DATABASE_SSL", false) && {
          rejectUnauthorized: env.bool("DATABASE_SSL_REJECT_UNAUTHORIZED", true),
        },
        schema: env("DATABASE_SCHEMA", "public"),
      },
      pool: { min: env.int("DATABASE_POOL_MIN", 2), max: env.int("DATABASE_POOL_MAX", 10) },
      acquireConnectionTimeout: env.int("DATABASE_CONNECTION_TIMEOUT", 60000),
    },
  };
};

export default config;
