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
    url: process.env.DATABASE_URL ?? process.env.JASSMINDB_URI ?? "",
  },
});
