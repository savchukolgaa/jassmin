import { existsSync } from "node:fs";
import { z } from "zod";
import { PAYMENT_PROVIDERS } from "~/lib/enums";

// Outgoing mail. Its own schema, so the order email job (`pnpm db:send-order-emails`) can read
// it without the web app's variables.
const mailEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  // SMTP server for contact form and order emails, e.g. smtp://localhost:2525 (smtp4dev). Under
  // Aspire it's the `smtp4dev` container. Optional: without it, development logs contact messages
  // instead of sending them, and order emails stay queued.
  SMTP_URL: z.url({ protocol: /^smtps?$/ }).optional(),
  CONTACT_INBOX: z.email().default("hello@jassmin.ua"),
  CONTACT_FROM: z.string().min(1).default("Jassmin website <no-reply@jassmin.ua>"),
  // Sender of order emails (#45); `CONTACT_FROM` when unset.
  ORDER_FROM: z.string().min(1).optional(),
});

// Pushing orders and stock to Strapi (#40). Its own schema, so `pnpm db:sync-cms` can read it
// without the web app's variables.
const cmsSyncEnvSchema = z.object({
  STRAPI_URL: z.url().default("http://localhost:1337"),
  // Strapi API token that may create and update products and orders. Optional: without it,
  // changes stay queued in `cms_outbox` until it is set.
  STRAPI_SYNC_TOKEN: z.string().min(1).optional(),
});

const envSchema = z
  .object({
    DATABASE_URL: z.url(),
    SESSION_SECRET: z.string().min(32),
    PORT: z.coerce.number().int().positive().default(3000),
    // Optional so the app boots before the first Strapi admin has created the token;
    // CMS-backed pages answer with a 503 until it is set.
    STRAPI_API_TOKEN: z.string().min(1).optional(),
    // Shared secret Strapi sends to the app's `/cms/*` sync routes (#40). Optional: without it
    // those routes answer 503 and product and order edits in Strapi fail with a clear error.
    CMS_SYNC_SECRET: z.string().min(32).optional(),
    ...cmsSyncEnvSchema.shape,
    // Where card payments go (#44). Optional: without it the app still starts and card payment is
    // unavailable at checkout. `simulator` is the local fake payment page, never for production.
    PAYMENT_PROVIDER: z.enum(PAYMENT_PROVIDERS).optional(),
    // The site's public origin, e.g. https://jassmin.ua (#85): canonical and Open Graph URLs are
    // built from it, never from the `Host` header. Required in production; elsewhere the request's
    // origin stands in.
    PUBLIC_SITE_URL: z
      .url({ protocol: /^https?$/ })
      .transform((url) => url.replace(/\/+$/, ""))
      .optional(),
    ...mailEnvSchema.shape,
  })
  .refine((env) => env.NODE_ENV !== "production" || env.PUBLIC_SITE_URL !== undefined, {
    path: ["PUBLIC_SITE_URL"],
    message: "PUBLIC_SITE_URL is required in production",
  })
  .refine((env) => !(env.PAYMENT_PROVIDER === "simulator" && env.NODE_ENV === "production"), {
    path: ["PAYMENT_PROVIDER"],
    message: "The payment simulator can't be used in production",
  });

export type Env = z.infer<typeof envSchema>;

export type MailEnv = z.infer<typeof mailEnvSchema>;

export type CmsSyncEnv = z.infer<typeof cmsSyncEnvSchema>;

/** The mail variables, with empty values counting as unset. */
function mailSource(source: NodeJS.ProcessEnv) {
  return {
    SMTP_URL: source.SMTP_URL || undefined,
    CONTACT_INBOX: source.CONTACT_INBOX || undefined,
    CONTACT_FROM: source.CONTACT_FROM || undefined,
    ORDER_FROM: source.ORDER_FROM || undefined,
  };
}

/** The Strapi URL (falling back to Aspire's `CMS_HTTP`) and sync token, empty values unset. */
function cmsSyncSource(source: NodeJS.ProcessEnv) {
  return {
    STRAPI_URL: source.STRAPI_URL || source.CMS_HTTP || undefined,
    STRAPI_SYNC_TOKEN: source.STRAPI_SYNC_TOKEN || undefined,
  };
}

function invalid(error: z.ZodError): Error {
  return new Error(`Invalid environment variables:\n${z.prettifyError(error)}`);
}

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
    STRAPI_API_TOKEN: source.STRAPI_API_TOKEN || undefined,
    CMS_SYNC_SECRET: source.CMS_SYNC_SECRET || undefined,
    ...cmsSyncSource(source),
    PAYMENT_PROVIDER: source.PAYMENT_PROVIDER || undefined,
    PUBLIC_SITE_URL: source.PUBLIC_SITE_URL || undefined,
    ...mailSource(source),
  });

  if (!result.success) {
    throw invalid(result.error);
  }

  return result.data;
}

/** Validates only the mail variables, for scripts that send email without the web app's env. */
export function parseMailEnv(source: NodeJS.ProcessEnv): MailEnv {
  const result = mailEnvSchema.safeParse({ ...source, ...mailSource(source) });
  if (!result.success) {
    throw invalid(result.error);
  }
  return result.data;
}

/** Validates only the Strapi sync variables, for `pnpm db:sync-cms` (#40). */
export function parseCmsSyncEnv(source: NodeJS.ProcessEnv): CmsSyncEnv {
  const result = cmsSyncEnvSchema.safeParse(cmsSyncSource(source));
  if (!result.success) {
    throw invalid(result.error);
  }
  return result.data;
}

/**
 * The site's public origin without a trailing slash: `PUBLIC_SITE_URL`, or outside production
 * (where it is optional) the request's origin.
 */
export function getSiteUrl(env: Pick<Env, "PUBLIC_SITE_URL">, request: Request): string {
  return env.PUBLIC_SITE_URL ?? new URL(request.url).origin;
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
