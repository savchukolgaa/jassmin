import { existsSync } from "node:fs";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.url(),
  SESSION_SECRET: z.string().min(32),
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Validates environment variables. `DATABASE_URL` falls back to `JASSMINDB_URI`,
 * which Aspire injects for the `jassmindb` database resource.
 */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse({
    ...source,
    DATABASE_URL: source.DATABASE_URL ?? source.JASSMINDB_URI,
  });

  if (!result.success) {
    throw new Error(`Invalid environment variables:\n${z.prettifyError(result.error)}`);
  }

  return result.data;
}

let cached: Env | undefined;

/** Returns the validated environment, loading `.env` first if it exists (existing variables win). */
export function getEnv(): Env {
  if (!cached) {
    if (existsSync(".env")) {
      process.loadEnvFile(".env");
    }
    cached = parseEnv(process.env);
  }
  return cached;
}
