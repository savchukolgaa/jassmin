import { existsSync } from "node:fs";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.url(),
  SESSION_SECRET: z.string().min(32),
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  STRAPI_URL: z.url().default("http://localhost:1337"),
  // Optional so the app boots before the first Strapi admin has created the token;
  // CMS-backed pages answer with a 503 until it is set.
  STRAPI_API_TOKEN: z.string().min(1).optional(),
  // SMTP server for contact form emails, e.g. smtp://localhost:2525 (smtp4dev). Under Aspire it's
  // the `smtp4dev` container. Optional: without it, development logs messages instead of sending.
  SMTP_URL: z.url({ protocol: /^smtps?$/ }).optional(),
  CONTACT_INBOX: z.email().default("hello@jassmin.ua"),
  CONTACT_FROM: z.string().min(1).default("Jassmin website <no-reply@jassmin.ua>"),
});

export type Env = z.infer<typeof envSchema>;

/**
 * The app database URL: `JASSMINDB_URI` (injected by Aspire) wins over `DATABASE_URL`.
 * Returns `undefined` when neither is set.
 */
export function getDatabaseUrl(source: NodeJS.ProcessEnv): string | undefined {
  return source.JASSMINDB_URI || source.DATABASE_URL || undefined;
}

/**
 * Validates environment variables. The database URL is `JASSMINDB_URI` when Aspire injects it
 * for the `jassmindb` resource, otherwise `DATABASE_URL`: under `aspire run` the Aspire database
 * wins over a `DATABASE_URL` left in `.env` for non-Aspire runs. `STRAPI_URL` falls back
 * to the service-discovery URL Aspire injects for the `cms` resource.
 */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse({
    ...source,
    DATABASE_URL: getDatabaseUrl(source),
    STRAPI_URL: source.STRAPI_URL || source.CMS_HTTP || undefined,
    STRAPI_API_TOKEN: source.STRAPI_API_TOKEN || undefined,
    SMTP_URL: source.SMTP_URL || undefined,
    CONTACT_INBOX: source.CONTACT_INBOX || undefined,
    CONTACT_FROM: source.CONTACT_FROM || undefined,
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
