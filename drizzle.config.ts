import { existsSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./app/.server/db/schema.ts",
  out: "./app/.server/db/migrations",
  casing: "snake_case",
  dbCredentials: {
    // Same precedence as app/.server/env.ts: the Aspire-injected URL wins over .env.
    url: process.env.JASSMINDB_URI || process.env.DATABASE_URL || "",
  },
});
