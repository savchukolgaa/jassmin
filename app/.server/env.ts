import { existsSync } from "node:fs";
import { z } from "zod";
import { PAYMENT_PROVIDERS } from "~/lib/enums";

// Outgoing mail. Its own schema, so the order email job (`pnpm db:send-order-emails`) can read
// it without the web app's variables.
const mailEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  // SMTP server for every email, e.g. smtp://localhost:2525 (smtp4dev). Under Aspire it's the
  // `smtp4dev` container; in production the transactional provider (#134, see docs/email.md).
  // Required in production; elsewhere, without it, development logs contact messages instead of
  // sending them, and order emails stay queued.
  SMTP_URL: z.url({ protocol: /^smtps?$/ }).optional(),
  CONTACT_INBOX: z.email().default("hello@jassmin.ua"),
  CONTACT_FROM: z.string().min(1).default("Jassmin website <no-reply@jassmin.ua>"),
  // Sender of order emails (#45); `CONTACT_FROM` when unset.
  ORDER_FROM: z.string().min(1).optional(),
  // The site's public origin, e.g. https://jassmin.ua (#85): canonical and Open Graph URLs are
  // built from it, never from the `Host` header, and emails link to it (#134). Required in
  // production; elsewhere the request's origin stands in (and emails leave the link out).
  PUBLIC_SITE_URL: z
    .url({ protocol: /^https?$/ })
    .transform((url) => url.replace(/\/+$/, ""))
    .optional(),
  // Signs the unsubscribe links in marketing emails (#139, `unsubscribe-token.ts`). Optional:
  // without it no cart reminders are sent and production logs a warning. Changing it breaks the
  // links in emails already sent.
  EMAIL_UNSUBSCRIBE_SECRET: z.string().min(32).optional(),
  // The most newsletter emails sent in any 24 hours (#181, `pnpm db:send-newsletters`). The
  // provider's daily quota (Brevo's free plan: 300) is shared with order, auth and reminder
  // emails, so the default leaves room for them.
  NEWSLETTER_DAILY_LIMIT: z.coerce.number().int().min(1).max(100_000).default(200),
});

/** Production needs a real SMTP server (#134): without one no email would ever go out. */
function hasSmtpInProduction(env: { NODE_ENV: string; SMTP_URL?: string | undefined }): boolean {
  return env.NODE_ENV !== "production" || env.SMTP_URL !== undefined;
}

const SMTP_REQUIRED = { path: ["SMTP_URL"], message: "SMTP_URL is required in production" };

// Pushing orders and stock to Strapi (#40). Its own schema, so `pnpm db:sync-cms` can read it
// without the web app's variables.
const cmsSyncEnvSchema = z.object({
  STRAPI_URL: z.url().default("http://localhost:1337"),
  // Strapi API token that may create and update products and orders. Optional: without it,
  // changes stay queued in `cms_outbox` until it is set.
  STRAPI_SYNC_TOKEN: z.string().min(1).optional(),
});

// The AI perfumer (#162, docs/ai-perfumer.md): any OpenAI-compatible chat-completions server,
// local Ollama by default. Its own schema, so `pnpm ai:perfumer-eval` can read it without the web
// app's variables. Without `AI_BASE_URL` the perfumer is off and nothing calls a model.
const aiEnvSchema = z.object({
  // e.g. http://localhost:11434/v1 (Ollama); `/chat/completions` is appended.
  AI_BASE_URL: z
    .url({ protocol: /^https?$/ })
    .transform((url) => url.replace(/\/+$/, ""))
    .optional(),
  AI_MODEL: z.string().min(1).default("granite4.1:3b"),
  // Bearer token for a hosted provider; Ollama needs none.
  AI_API_KEY: z.string().min(1).optional(),
  // The most one perfumer reply may take, tool rounds included.
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(600_000).default(90_000),
  // Sent to Ollama as `keep_alive` (e.g. `30m`, `-1`) so the model stays loaded between replies.
  AI_KEEP_ALIVE: z
    .string()
    .regex(/^-?\d+(ms|s|m|h)?$/)
    .optional(),
  // The hosted model's provider as the privacy policy names it (e.g. `OpenRouter`, #167). Unset
  // when the model runs on the shop's own server: then no message leaves it.
  AI_PROVIDER_NAME: z.string().trim().min(1).max(80).optional(),
});

/** A LiqPay key that is set and isn't the deploy's `pending` placeholder (docs/payments.md). */
function isLiqPayKey(key: string | undefined): boolean {
  return key !== undefined && key !== "pending";
}

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
    // Where card payments go (#44). Optional: without it (or with `none`, production's default) the
    // app still starts and card payment is unavailable at checkout. `simulator` is the local fake
    // payment page, never for production; `liqpay` is LiqPay (#192).
    PAYMENT_PROVIDER: z.enum(PAYMENT_PROVIDERS).optional(),
    // LiqPay's merchant keys (#192), required with `PAYMENT_PROVIDER=liqpay`. Production secrets
    // only, never committed. See docs/payments.md.
    LIQPAY_PUBLIC_KEY: z.string().trim().min(1).optional(),
    LIQPAY_PRIVATE_KEY: z.string().trim().min(1).optional(),
    // LiqPay's test mode: test cards, no money moves. Unset, it's on outside production and off in
    // production; a staging server in production mode sets `true` on purpose. See isLiqPaySandbox.
    LIQPAY_SANDBOX: z.stringbool().optional(),
    // Put in front of each LiqPay `order_id`, so a reset development database or a staging server
    // never reuses one LiqPay has seen (e.g. `dev-olga-`). Production leaves it unset.
    LIQPAY_ORDER_PREFIX: z
      .string()
      .regex(/^[\w-]{1,32}$/)
      .optional(),
    // Bearer secret the email provider sends to `/hooks/email` with bounces and complaints
    // (#134). Optional: without it the webhook answers 503 and production logs a warning.
    EMAIL_WEBHOOK_SECRET: z.string().min(32).optional(),
    // `/robots.txt` answers `Disallow: /` when this is set, or whenever NODE_ENV isn't production
    // (#87): for a staging or preview server that runs in production mode. `true`/`1`/`yes`/`on`.
    ROBOTS_DISALLOW_ALL: z.stringbool().optional(),
    // Content-Security-Policy mode (#143): `report-only` sends `Content-Security-Policy-Report-Only`
    // (violations are only logged), `enforce` sends `Content-Security-Policy`. See docs/security.md.
    CSP_MODE: z.enum(["report-only", "enforce"]).default("report-only"),
    // How many reverse proxies in front of the app append to `X-Forwarded-For` (#143). The client IP
    // is the entry that many places from the right; 0 ignores the header (it can't be spoofed, but
    // then the IP is unknown). Set it to 1 behind a single hosting proxy. See docs/security.md.
    TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
    ...mailEnvSchema.shape,
    ...aiEnvSchema.shape,
  })
  .refine(hasSmtpInProduction, SMTP_REQUIRED)
  .refine((env) => env.NODE_ENV !== "production" || env.PUBLIC_SITE_URL !== undefined, {
    path: ["PUBLIC_SITE_URL"],
    message: "PUBLIC_SITE_URL is required in production",
  })
  .refine((env) => !(env.PAYMENT_PROVIDER === "simulator" && env.NODE_ENV === "production"), {
    path: ["PAYMENT_PROVIDER"],
    message: "The payment simulator can't be used in production",
  })
  .refine(
    (env) =>
      env.PAYMENT_PROVIDER !== "liqpay" ||
      (isLiqPayKey(env.LIQPAY_PUBLIC_KEY) && isLiqPayKey(env.LIQPAY_PRIVATE_KEY)),
    {
      path: ["PAYMENT_PROVIDER"],
      message: "PAYMENT_PROVIDER=liqpay needs LIQPAY_PUBLIC_KEY and LIQPAY_PRIVATE_KEY",
    },
  );

export type Env = z.infer<typeof envSchema>;

export type MailEnv = z.infer<typeof mailEnvSchema>;

export type CmsSyncEnv = z.infer<typeof cmsSyncEnvSchema>;

export type AiEnv = z.infer<typeof aiEnvSchema>;

/** The mail variables, with empty values counting as unset. */
function mailSource(source: NodeJS.ProcessEnv) {
  return {
    SMTP_URL: source.SMTP_URL || undefined,
    CONTACT_INBOX: source.CONTACT_INBOX || undefined,
    CONTACT_FROM: source.CONTACT_FROM || undefined,
    ORDER_FROM: source.ORDER_FROM || undefined,
    PUBLIC_SITE_URL: source.PUBLIC_SITE_URL || undefined,
    EMAIL_UNSUBSCRIBE_SECRET: source.EMAIL_UNSUBSCRIBE_SECRET || undefined,
    NEWSLETTER_DAILY_LIMIT: source.NEWSLETTER_DAILY_LIMIT || undefined,
  };
}

/** The Strapi URL (falling back to Aspire's `CMS_HTTP`) and sync token, empty values unset. */
function cmsSyncSource(source: NodeJS.ProcessEnv) {
  return {
    STRAPI_URL: source.STRAPI_URL || source.CMS_HTTP || undefined,
    STRAPI_SYNC_TOKEN: source.STRAPI_SYNC_TOKEN || undefined,
  };
}

/** The AI perfumer variables (#162), empty values unset. */
function aiSource(source: NodeJS.ProcessEnv) {
  return {
    AI_BASE_URL: source.AI_BASE_URL || undefined,
    AI_MODEL: source.AI_MODEL || undefined,
    AI_API_KEY: source.AI_API_KEY || undefined,
    AI_TIMEOUT_MS: source.AI_TIMEOUT_MS || undefined,
    AI_KEEP_ALIVE: source.AI_KEEP_ALIVE || undefined,
    AI_PROVIDER_NAME: source.AI_PROVIDER_NAME?.trim() || undefined,
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
    PAYMENT_PROVIDER:
      source.PAYMENT_PROVIDER === "none" ? undefined : source.PAYMENT_PROVIDER || undefined,
    LIQPAY_PUBLIC_KEY: source.LIQPAY_PUBLIC_KEY?.trim() || undefined,
    LIQPAY_PRIVATE_KEY: source.LIQPAY_PRIVATE_KEY?.trim() || undefined,
    LIQPAY_SANDBOX: source.LIQPAY_SANDBOX || undefined,
    LIQPAY_ORDER_PREFIX: source.LIQPAY_ORDER_PREFIX || undefined,
    EMAIL_WEBHOOK_SECRET: source.EMAIL_WEBHOOK_SECRET || undefined,
    ROBOTS_DISALLOW_ALL: source.ROBOTS_DISALLOW_ALL || undefined,
    CSP_MODE: source.CSP_MODE || undefined,
    TRUSTED_PROXY_HOPS: source.TRUSTED_PROXY_HOPS || undefined,
    ...mailSource(source),
    ...aiSource(source),
  });

  if (!result.success) {
    throw invalid(result.error);
  }

  return result.data;
}

/** Validates only the AI perfumer variables, for `pnpm ai:perfumer-eval` (#162). */
export function parseAiEnv(source: NodeJS.ProcessEnv): AiEnv {
  const result = aiEnvSchema.safeParse(aiSource(source));
  if (!result.success) {
    throw invalid(result.error);
  }
  return result.data;
}

/** Validates only the mail variables, for scripts that send email without the web app's env. */
export function parseMailEnv(source: NodeJS.ProcessEnv): MailEnv {
  const result = mailEnvSchema
    .refine(hasSmtpInProduction, SMTP_REQUIRED)
    .safeParse({ ...source, ...mailSource(source) });
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
 * Whether LiqPay runs in test mode (#192): `LIQPAY_SANDBOX` when set, otherwise on everywhere but
 * production, so a live shop never takes test payments by accident and a developer never takes
 * real ones.
 */
export function isLiqPaySandbox(env: Partial<Pick<Env, "LIQPAY_SANDBOX" | "NODE_ENV">>): boolean {
  return env.LIQPAY_SANDBOX ?? env.NODE_ENV !== "production";
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
    if (cached.NODE_ENV === "production" && !cached.EMAIL_WEBHOOK_SECRET) {
      console.warn(
        "[env] EMAIL_WEBHOOK_SECRET is not set: bounces and spam complaints aren't recorded (see docs/email.md)",
      );
    }
    if (cached.NODE_ENV === "production" && !cached.EMAIL_UNSUBSCRIBE_SECRET) {
      console.warn(
        "[env] EMAIL_UNSUBSCRIBE_SECRET is not set: no cart reminders are sent and unsubscribe links don't work (see docs/email.md)",
      );
    }
    if (
      cached.NODE_ENV === "production" &&
      cached.PAYMENT_PROVIDER === "liqpay" &&
      isLiqPaySandbox(cached)
    ) {
      console.warn(
        "[env] LIQPAY_SANDBOX=true in production: card payments are LiqPay test payments and no money is taken (see docs/payments.md)",
      );
    }
  }
  return cached;
}
