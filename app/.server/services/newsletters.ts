// Sending a newsletter (#181). Staff press "send" in Strapi once: `sendNewsletter` stores what they
// wrote and queues one delivery per customer who agreed to marketing email, confirmed their
// address and isn't suppressed, in one transaction, refusing a second send and a send within a
// week of the last. `deliverNewsletters` (the `pnpm db:send-newsletters` job) then sends the queued
// deliveries within `NEWSLETTER_DAILY_LIMIT`, checking each customer again right before. "Send a
// test to me" (`sendNewsletterTest`) emails only the staff member and changes nothing.
//
// It must not import `db/index.ts`: the job runs without the web app's env and brings its own pool.
import { sql } from "drizzle-orm";
import { createTranslator } from "~/lib/i18n";
import type { Locale } from "~/lib/i18n/locales";
import {
  NEWSLETTER_INTERVAL_DAYS,
  NEWSLETTER_MAX_ATTEMPTS,
  NEWSLETTER_RETRY_DELAYS_MINUTES,
  type NewsletterContent,
  type NewsletterState,
  type NewsletterText,
} from "~/lib/newsletter";
import type { Db } from "../db/client";
import { pgErrorCode, UNIQUE_VIOLATION } from "../db/errors";
import { enqueueCmsSync } from "../db/queries/cms-outbox";
import {
  type ClaimedNewsletterDelivery,
  claimNewsletterDeliveries,
  countNewsletterAttemptsSince,
  findNewsletterContent,
  findNewsletterIdByDocumentId,
  findNewsletterRecipient,
  findNewsletterSendBlock,
  findNewsletterSyncState,
  findUserIdByEmail,
  finishNewsletters,
  insertNewsletter,
  isNewsletterSlugTaken,
  markNewsletterDeliveryFailed,
  markNewsletterDeliverySent,
  markNewsletterDeliverySkipped,
  queueNewsletterDeliveries,
  type StoredNewsletter,
} from "../db/queries/newsletters";
import { listProductSummariesByPublicIds } from "../db/queries/products";
import { unsubscribeUrl } from "../email/marketing";
import type { MailEnv } from "../env";
import { type MailSender, SuppressedRecipientError } from "../mail";
import { createUnsubscribeToken } from "../unsubscribe-token";
import { buildNewsletterEmail, type NewsletterProduct } from "./newsletter-email";
import type { OrderEmailEnv } from "./order-email";

export type NewsletterEnv = OrderEmailEnv &
  Pick<MailEnv, "NEWSLETTER_DAILY_LIMIT"> &
  Partial<Pick<MailEnv, "EMAIL_UNSUBSCRIBE_SECRET">>;

export interface NewsletterDeps {
  db: Db;
  /** `null` when `SMTP_URL` is not configured. */
  mailer: MailSender | null;
  env: NewsletterEnv;
  now?: () => Date;
}

/** The header that tags a newsletter email with its delivery, for tracing in the provider. */
export const NEWSLETTER_TAG = "X-Mailin-custom";

export function newsletterTag(deliveryId: number): string {
  return `newsletter:${deliveryId}`;
}

/** Deliveries the job claims at a time. */
export const NEWSLETTER_BATCH_SIZE = 50;

/** `error` keeps at most this many characters. */
const MAX_ERROR_LENGTH = 500;

/** A fixed key for `pg_advisory_xact_lock`, so two sends at once are taken one after the other. */
const SEND_LOCK_KEY = 181_181;

/** What is missing to send newsletters, or `undefined` when nothing is. */
export function missingNewsletterConfig(
  mailer: MailSender | null,
  env: NewsletterEnv,
): string[] | undefined {
  const missing = [
    mailer ? null : "SMTP_URL",
    env.PUBLIC_SITE_URL ? null : "PUBLIC_SITE_URL",
    env.EMAIL_UNSUBSCRIBE_SECRET ? null : "EMAIL_UNSUBSCRIBE_SECRET",
  ].filter((name): name is string => name !== null);
  return missing.length > 0 ? missing : undefined;
}

export type SendNewsletterResult =
  | { ok: true; newsletterId: number; state: NewsletterState }
  | { ok: false; error: "mail-not-configured"; missing: string[] }
  | { ok: false; error: "already-sent" }
  | { ok: false; error: "newsletter-slug-taken"; slug: string }
  | { ok: false; error: "another-sending" }
  | { ok: false; error: "too-soon"; nextAllowedAt: string }
  | { ok: false; error: "no-recipients" };

class NoRecipients extends Error {}

/**
 * Sends the newsletter from Strapi document `documentId`: stores `content` and queues it for
 * every eligible customer, in one transaction that also queues the counts for Strapi. A second
 * send of the same document, a slug another newsletter used, a send while another newsletter is still going out, one within
 * `NEWSLETTER_INTERVAL_DAYS` of the last, and one nobody would get are refused, writing nothing.
 */
export async function sendNewsletter(
  documentId: string,
  content: NewsletterContent,
  { db, mailer, env, now = () => new Date() }: NewsletterDeps,
): Promise<SendNewsletterResult> {
  const missing = missingNewsletterConfig(mailer, env);
  if (missing) {
    return { ok: false, error: "mail-not-configured", missing };
  }
  const at = now();
  try {
    const outcome = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${SEND_LOCK_KEY})`);
      if ((await findNewsletterIdByDocumentId(tx, documentId)) !== undefined) {
        return { ok: false, error: "already-sent" } as const;
      }
      // The slug is the campaign in the analytics, so each newsletter needs its own.
      if (await isNewsletterSlugTaken(tx, content.slug)) {
        return { ok: false, error: "newsletter-slug-taken", slug: content.slug } as const;
      }
      const block = await findNewsletterSendBlock(tx, at, NEWSLETTER_INTERVAL_DAYS);
      if (block?.error === "too-soon") {
        return {
          ok: false,
          error: "too-soon",
          nextAllowedAt: block.nextAllowedAt.toISOString(),
        } as const;
      }
      if (block) {
        return { ok: false, error: block.error } as const;
      }
      const newsletterId = await insertNewsletter(tx, documentId, content, at);
      const queued = await queueNewsletterDeliveries(tx, newsletterId, content.en !== null);
      if (queued === 0) {
        throw new NoRecipients();
      }
      await enqueueCmsSync(tx, "newsletter", [newsletterId]);
      return { ok: true, newsletterId } as const;
    });
    if (!outcome.ok) return outcome;
    const state = await findNewsletterSyncState(db, outcome.newsletterId);
    if (!state) throw new Error(`Newsletter ${outcome.newsletterId} vanished after sending`);
    return {
      ok: true,
      newsletterId: outcome.newsletterId,
      state: { status: state.status, counts: state.counts, sentAt: state.sentAt.toISOString() },
    };
  } catch (error) {
    if (error instanceof NoRecipients) {
      return { ok: false, error: "no-recipients" };
    }
    if (pgErrorCode(error) === UNIQUE_VIOLATION) {
      return { ok: false, error: "already-sent" };
    }
    throw error;
  }
}

/** The featured products still on sale, in staff's order, at the lowest price of a size in stock. */
export async function loadNewsletterProducts(
  db: Db,
  publicIds: readonly string[],
): Promise<NewsletterProduct[]> {
  if (publicIds.length === 0) return [];
  const rows = await listProductSummariesByPublicIds(db, publicIds);
  const byId = new Map(rows.map((row) => [row.publicId, row]));
  const products: NewsletterProduct[] = [];
  for (const publicId of publicIds) {
    const row = byId.get(publicId);
    const prices = (row?.variants ?? [])
      .filter((variant) => variant.inStock)
      .map((variant) => variant.price);
    if (!row || prices.length === 0) continue;
    const sorted = [...prices].sort((a, b) => Number(a) - Number(b));
    const minPrice = sorted[0] ?? "0";
    products.push({
      publicId: row.publicId,
      slug: row.slug,
      title: row.title,
      brand: row.brand,
      imageUrl: row.imageUrl,
      minPrice,
      hasPriceRange: sorted.some((price) => Number(price) !== Number(minPrice)),
    });
  }
  return products;
}

/** The text a customer with this delivery language gets: English when there is one, else uk. */
function textFor(newsletter: NewsletterContent, locale: Locale): NewsletterText {
  return locale === "en" && newsletter.en ? newsletter.en : newsletter.uk;
}

export type SendNewsletterTestResult =
  | { ok: true; sent: number }
  | { ok: false; error: "mail-not-configured"; missing: string[] }
  | { ok: false; error: "test-suppressed" }
  | { ok: false; error: "mail-failed" };

/**
 * "Send a test to me": one email per language the newsletter has, only to `to` (the staff
 * member's own address), with "[Test]" in the subject. Nothing is stored or counted, and the weekly
 * rule and the daily limit don't apply. The unsubscribe link is the shop user's with that address
 * when there is one, so it can be tried; otherwise there is none.
 */
export async function sendNewsletterTest(
  content: NewsletterContent,
  to: { email: string; name: string },
  { db, mailer, env }: NewsletterDeps,
): Promise<SendNewsletterTestResult> {
  const siteUrl = env.PUBLIC_SITE_URL;
  if (!mailer || !siteUrl) {
    return {
      ok: false,
      error: "mail-not-configured",
      missing:
        missingNewsletterConfig(mailer, env)?.filter(
          (name) => name !== "EMAIL_UNSUBSCRIBE_SECRET",
        ) ?? [],
    };
  }
  const products = await loadNewsletterProducts(db, content.productPublicIds);
  const userId = await findUserIdByEmail(db, to.email);
  const locales: Locale[] = content.en ? ["uk", "en"] : ["uk"];
  let sent = 0;
  try {
    for (const locale of locales) {
      const secret = env.EMAIL_UNSUBSCRIBE_SECRET;
      const unsubscribe =
        userId !== undefined && secret
          ? unsubscribeUrl(siteUrl, locale, createUnsubscribeToken(userId, secret))
          : null;
      const message = buildNewsletterEmail(
        {
          slug: content.slug,
          text: textFor(content, locale),
          products,
          recipient: { fullName: to.name, email: to.email },
          unsubscribeUrl: unsubscribe,
          test: true,
        },
        createTranslator(locale),
        env,
        siteUrl,
      );
      await mailer.sendMail(message);
      sent += 1;
    }
  } catch (error) {
    if (error instanceof SuppressedRecipientError) {
      return { ok: false, error: "test-suppressed" };
    }
    console.error(`[newsletter] The test send failed: ${errorMessage(error)}`);
    return { ok: false, error: "mail-failed" };
  }
  return { ok: true, sent };
}

export interface NewsletterDeliveryReport {
  sent: number;
  /** Failed this time; due again after the backoff. */
  retrying: number;
  /** Failed for the last time. */
  failed: number;
  /** Not sent: unsubscribed, unverified or suppressed since it was queued. */
  skipped: number;
  /** The daily limit stopped this run with deliveries still due. */
  limitReached: boolean;
  /** Newsletters this run finished (`sent`). */
  finished: number[];
  /** Nothing was tried for lack of configuration. */
  notConfigured: string[] | null;
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, MAX_ERROR_LENGTH);
}

interface DeliveryContext {
  db: Db;
  mailer: MailSender;
  env: NewsletterEnv;
  siteUrl: string;
  secret: string;
  newsletters: Map<number, { content: StoredNewsletter; products: NewsletterProduct[] } | null>;
}

async function newsletterFor(context: DeliveryContext, newsletterId: number) {
  if (!context.newsletters.has(newsletterId)) {
    const content = await findNewsletterContent(context.db, newsletterId);
    context.newsletters.set(
      newsletterId,
      content
        ? { content, products: await loadNewsletterProducts(context.db, content.productPublicIds) }
        : null,
    );
  }
  return context.newsletters.get(newsletterId) ?? null;
}

/** Sends one claimed delivery; returns whether it was handed to the provider (sent or failed). */
async function deliverOne(
  delivery: ClaimedNewsletterDelivery,
  context: DeliveryContext,
  report: NewsletterDeliveryReport,
): Promise<boolean> {
  const { db } = context;
  const label = `newsletter ${delivery.newsletterId}'s delivery ${delivery.id}`;
  const skip = async (reason: string) => {
    console.info(`[newsletter] Not sending ${label}: ${reason}`);
    await markNewsletterDeliverySkipped(db, delivery.id, reason);
    report.skipped += 1;
    return false;
  };
  try {
    const recipient = await findNewsletterRecipient(db, delivery.userId);
    if (!recipient) return await skip("the user is gone");
    if (!recipient.marketingOptIn) return await skip("unsubscribed");
    if (!recipient.emailVerified) return await skip("email not verified");
    if (recipient.suppressed) return await skip("suppressed");
    const newsletter = await newsletterFor(context, delivery.newsletterId);
    if (!newsletter) return await skip("the newsletter is gone");

    const message = buildNewsletterEmail(
      {
        slug: newsletter.content.slug,
        text: textFor(newsletter.content, delivery.locale),
        products: newsletter.products,
        recipient,
        unsubscribeUrl: unsubscribeUrl(
          context.siteUrl,
          delivery.locale,
          createUnsubscribeToken(recipient.userId, context.secret),
        ),
      },
      createTranslator(delivery.locale),
      context.env,
      context.siteUrl,
    );
    // The email's own headers (`List-Unsubscribe`) are kept; the tag is added.
    await context.mailer.sendMail({
      ...message,
      headers: {
        ...(message.headers as Record<string, string> | undefined),
        [NEWSLETTER_TAG]: newsletterTag(delivery.id),
      },
    });
    report.sent += 1;
    await markNewsletterDeliverySent(db, delivery.id, message.messageId).catch((error: unknown) =>
      console.error(`[newsletter] Recording ${label} as sent failed:`, error),
    );
    return true;
  } catch (error) {
    if (error instanceof SuppressedRecipientError) {
      return skip(`suppressed: ${error.reasons.join(", ")}`).catch(() => false);
    }
    const final = delivery.attempts >= NEWSLETTER_MAX_ATTEMPTS;
    const message = errorMessage(error);
    console.error(
      `[newsletter] Sending ${label} failed (attempt ${delivery.attempts} of ${NEWSLETTER_MAX_ATTEMPTS}${final ? ", giving up" : ""}): ${message}`,
    );
    await markNewsletterDeliveryFailed(db, delivery.id, { error: message, final }).catch(
      (markError: unknown) =>
        console.error(`[newsletter] Recording the failure of ${label} failed:`, markError),
    );
    report[final ? "failed" : "retrying"] += 1;
    return true;
  }
}

/**
 * Sends the due queued deliveries, at most `NEWSLETTER_DAILY_LIMIT` in any 24 hours (what doesn't
 * fit waits for a later run), then marks the newsletters with nothing left queued as `sent` and
 * queues every newsletter it touched for Strapi. Never rejects.
 */
export async function deliverNewsletters({
  db,
  mailer,
  env,
  now = () => new Date(),
}: NewsletterDeps): Promise<NewsletterDeliveryReport> {
  const report: NewsletterDeliveryReport = {
    sent: 0,
    retrying: 0,
    failed: 0,
    skipped: 0,
    limitReached: false,
    finished: [],
    notConfigured: null,
  };
  const missing = missingNewsletterConfig(mailer, env);
  if (missing || !mailer || !env.PUBLIC_SITE_URL || !env.EMAIL_UNSUBSCRIBE_SECRET) {
    return { ...report, notConfigured: missing ?? [] };
  }
  const context: DeliveryContext = {
    db,
    mailer,
    env,
    siteUrl: env.PUBLIC_SITE_URL,
    secret: env.EMAIL_UNSUBSCRIBE_SECRET,
    newsletters: new Map(),
  };
  const touched = new Set<number>();
  try {
    const since = new Date(now().getTime() - 24 * 60 * 60 * 1000);
    let budget = env.NEWSLETTER_DAILY_LIMIT - (await countNewsletterAttemptsSince(db, since));
    // Claimed rows aren't due again until their retry time, so this loop ends.
    while (budget > 0) {
      const limit = Math.min(budget, NEWSLETTER_BATCH_SIZE);
      const batch = await claimNewsletterDeliveries(db, {
        limit,
        retryDelaysMinutes: NEWSLETTER_RETRY_DELAYS_MINUTES,
      });
      for (const delivery of batch) {
        touched.add(delivery.newsletterId);
        if (await deliverOne(delivery, context, report)) {
          budget -= 1;
        }
      }
      if (batch.length < limit) break;
    }
    if (budget <= 0) {
      report.limitReached = await hasDueDeliveries(db);
    }
    report.finished = await finishNewsletters(db, [...touched]);
    await enqueueCmsSync(db, "newsletter", [...touched]);
  } catch (error) {
    console.error("[newsletter] Delivering newsletters failed:", error);
  }
  return report;
}

async function hasDueDeliveries(db: Db): Promise<boolean> {
  const result = await db.execute(
    sql`select 1 from newsletter_deliveries where status = 'queued' limit 1`,
  );
  return result.rows.length > 0;
}

/** The job's log line. */
export function describeNewsletterReport(report: NewsletterDeliveryReport): string {
  if (report.notConfigured) {
    return `No newsletters sent: ${report.notConfigured.join(", ")} not set (see docs/email.md).`;
  }
  const parts = [
    `Sent ${report.sent} newsletter email${report.sent === 1 ? "" : "s"}`,
    `${report.retrying} to retry`,
    `${report.failed} failed`,
    `${report.skipped} skipped`,
  ];
  const finished =
    report.finished.length > 0 ? ` Finished newsletter ${report.finished.join(", ")}.` : "";
  const limit = report.limitReached
    ? " NEWSLETTER_DAILY_LIMIT reached; the rest goes out in a later run."
    : "";
  return `${parts.join(", ")}.${finished}${limit}`;
}
