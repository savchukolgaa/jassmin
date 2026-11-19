// Newsletters (#181): storing a sent newsletter with one queued delivery per eligible customer,
// the weekly rule, and the delivery queue `pnpm db:send-newsletters` works through.
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { NewsletterDeliveryStatus, NewsletterStatus } from "~/lib/enums";
import type { Locale } from "~/lib/i18n/locales";
import type { NewsletterContent, NewsletterCounts, NewsletterText } from "~/lib/newsletter";
import type { Db } from "../client";
import { newsletterDeliveries, newsletters } from "../schema";

/** A `Db` or a transaction. */
type Executor = Pick<Db, "select" | "insert" | "update" | "execute">;

/** The newsletter sent from this Strapi document, if any. */
export async function findNewsletterIdByDocumentId(
  db: Executor,
  documentId: string,
): Promise<number | undefined> {
  const [row] = await db
    .select({ id: newsletters.id })
    .from(newsletters)
    .where(eq(newsletters.strapiDocumentId, documentId));
  return row?.id;
}

/** Whether a newsletter already went out with this slug (its campaign). */
export async function isNewsletterSlugTaken(db: Executor, slug: string): Promise<boolean> {
  const rows = await db
    .select({ id: newsletters.id })
    .from(newsletters)
    .where(eq(newsletters.slug, slug))
    .limit(1);
  return rows.length > 0;
}

/** Why no newsletter may be sent now: one is still going out, or the last went out too recently. */
export type NewsletterSendBlock =
  | { error: "another-sending" }
  | { error: "too-soon"; nextAllowedAt: Date };

/**
 * Whether the weekly rule allows a new newsletter at `now`: none may still be `sending`, and the
 * latest must have been sent at least `intervalDays` ago. `undefined` when it may be sent.
 */
export async function findNewsletterSendBlock(
  db: Executor,
  now: Date,
  intervalDays: number,
): Promise<NewsletterSendBlock | undefined> {
  const [latest] = await db
    .select({ status: newsletters.status, sentAt: newsletters.sentAt })
    .from(newsletters)
    .orderBy(sql`${newsletters.sentAt} desc`, sql`${newsletters.id} desc`)
    .limit(1);
  if (!latest) return undefined;
  const sending = await db
    .select({ id: newsletters.id })
    .from(newsletters)
    .where(eq(newsletters.status, "sending"))
    .limit(1);
  if (sending.length > 0) return { error: "another-sending" };
  const nextAllowedAt = new Date(latest.sentAt.getTime() + intervalDays * 24 * 60 * 60 * 1000);
  return nextAllowedAt > now ? { error: "too-soon", nextAllowedAt } : undefined;
}

/** Stores what staff sent, as `sending`; returns its id. */
export async function insertNewsletter(
  db: Executor,
  documentId: string,
  content: NewsletterContent,
  now: Date,
): Promise<number> {
  const [row] = await db
    .insert(newsletters)
    .values({
      strapiDocumentId: documentId,
      slug: content.slug,
      subjectUk: content.uk.subject,
      preheaderUk: content.uk.preheader,
      bodyUk: content.uk.body,
      subjectEn: content.en?.subject ?? null,
      preheaderEn: content.en?.preheader ?? null,
      bodyEn: content.en?.body ?? null,
      productPublicIds: content.productPublicIds,
      status: "sending",
      sentAt: now,
    })
    .returning({ id: newsletters.id });
  if (!row) throw new Error("Inserting the newsletter returned no row");
  return row.id;
}

/**
 * Queues the newsletter for every customer who agreed to marketing email, confirmed their address
 * (#135) and isn't suppressed (#134), in their language (`users.locale`, Ukrainian when it's not
 * set or the newsletter has no English version). Returns how many were queued.
 */
export async function queueNewsletterDeliveries(
  db: Executor,
  newsletterId: number,
  hasEnglish: boolean,
): Promise<number> {
  const result = await db.execute<{ id: number }>(sql`
    insert into newsletter_deliveries (newsletter_id, user_id, locale)
    select ${newsletterId}, u.id,
      case when ${hasEnglish} and u.locale = 'en' then 'en' else 'uk' end
    from users u
    where u.marketing_opt_in
      and u.email_verified_at is not null
      and not exists (select 1 from email_suppressions s where s.address = lower(u.email))
    order by u.id
    on conflict do nothing
    returning id`);
  return result.rows.length;
}

/** How the newsletter's deliveries stand. */
export async function countNewsletterDeliveries(
  db: Executor,
  newsletterId: number,
): Promise<NewsletterCounts> {
  const rows = await db
    .select({ status: newsletterDeliveries.status, count: sql<number>`count(*)::int` })
    .from(newsletterDeliveries)
    .where(eq(newsletterDeliveries.newsletterId, newsletterId))
    .groupBy(newsletterDeliveries.status);
  const by = new Map<NewsletterDeliveryStatus, number>(rows.map((row) => [row.status, row.count]));
  const sent = by.get("sent") ?? 0;
  const failed = by.get("failed") ?? 0;
  const skipped = by.get("skipped") ?? 0;
  return { queued: sent + failed + skipped + (by.get("queued") ?? 0), sent, failed, skipped };
}

/** A newsletter as Strapi shows it. */
export interface NewsletterSyncState {
  id: number;
  documentId: string;
  status: NewsletterStatus;
  sentAt: Date;
  counts: NewsletterCounts;
}

export async function findNewsletterSyncState(
  db: Executor,
  newsletterId: number,
): Promise<NewsletterSyncState | undefined> {
  const [row] = await db
    .select({
      id: newsletters.id,
      documentId: newsletters.strapiDocumentId,
      status: newsletters.status,
      sentAt: newsletters.sentAt,
    })
    .from(newsletters)
    .where(eq(newsletters.id, newsletterId));
  if (!row) return undefined;
  return { ...row, counts: await countNewsletterDeliveries(db, newsletterId) };
}

/** A sent newsletter's content, as it was when staff pressed "send". */
export interface StoredNewsletter extends NewsletterContent {
  id: number;
}

export async function findNewsletterContent(
  db: Executor,
  newsletterId: number,
): Promise<StoredNewsletter | undefined> {
  const [row] = await db.select().from(newsletters).where(eq(newsletters.id, newsletterId));
  if (!row) return undefined;
  const en: NewsletterText | null =
    row.subjectEn !== null && row.bodyEn !== null
      ? { subject: row.subjectEn, preheader: row.preheaderEn, body: row.bodyEn }
      : null;
  return {
    id: row.id,
    slug: row.slug,
    uk: { subject: row.subjectUk, preheader: row.preheaderUk, body: row.bodyUk },
    en,
    productPublicIds: row.productPublicIds,
  };
}

/** Newsletter emails handed to the provider since `since` (sent, or tried and failed). */
export async function countNewsletterAttemptsSince(db: Executor, since: Date): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(newsletterDeliveries)
    .where(gte(newsletterDeliveries.sentAt, since));
  return row?.count ?? 0;
}

export interface ClaimedNewsletterDelivery {
  id: number;
  newsletterId: number;
  userId: number;
  locale: Locale;
  attempts: number;
}

/**
 * Claims up to `limit` due `queued` deliveries, oldest newsletter first: counts the attempt and
 * moves `next_attempt_at` to when it may be retried (the same lease as `claimOrderEmails`), so
 * concurrent senders never get the same row.
 */
export function claimNewsletterDeliveries(
  db: Executor,
  { limit, retryDelaysMinutes }: { limit: number; retryDelaysMinutes: readonly number[] },
): Promise<ClaimedNewsletterDelivery[]> {
  if (
    retryDelaysMinutes.length === 0 ||
    retryDelaysMinutes.some((m) => !Number.isInteger(m) || m <= 0)
  ) {
    throw new Error("Retry delays must be whole positive minutes");
  }
  const due = db
    .select({ id: newsletterDeliveries.id })
    .from(newsletterDeliveries)
    .where(
      and(
        eq(newsletterDeliveries.status, "queued"),
        lte(newsletterDeliveries.nextAttemptAt, sql`now()`),
      ),
    )
    .orderBy(asc(newsletterDeliveries.newsletterId), asc(newsletterDeliveries.id))
    .limit(limit)
    .for("update", { skipLocked: true });
  const delays = `{${retryDelaysMinutes.join(",")}}`;
  return db
    .update(newsletterDeliveries)
    .set({
      attempts: sql`${newsletterDeliveries.attempts} + 1`,
      nextAttemptAt: sql`now() + make_interval(mins => (${delays}::int[])[least(${newsletterDeliveries.attempts} + 1, ${retryDelaysMinutes.length})])`,
    })
    .where(inArray(newsletterDeliveries.id, due))
    .returning({
      id: newsletterDeliveries.id,
      newsletterId: newsletterDeliveries.newsletterId,
      userId: newsletterDeliveries.userId,
      locale: newsletterDeliveries.locale,
      attempts: newsletterDeliveries.attempts,
    });
}

/** The customer a delivery goes to, read again right before sending. */
export interface NewsletterRecipient {
  userId: number;
  fullName: string;
  email: string;
  marketingOptIn: boolean;
  emailVerified: boolean;
  /** The address bounced or complained (#134). */
  suppressed: boolean;
}

export async function findNewsletterRecipient(
  db: Executor,
  userId: number,
): Promise<NewsletterRecipient | undefined> {
  const result = await db.execute<{
    user_id: number;
    full_name: string;
    email: string;
    marketing_opt_in: boolean;
    email_verified: boolean;
    suppressed: boolean;
  }>(sql`
    select u.id as user_id, u.full_name, u.email, u.marketing_opt_in,
      u.email_verified_at is not null as email_verified,
      exists (select 1 from email_suppressions s where s.address = lower(u.email)) as suppressed
    from users u
    where u.id = ${userId}`);
  const [row] = result.rows;
  if (!row) return undefined;
  return {
    userId: Number(row.user_id),
    fullName: row.full_name,
    email: row.email,
    marketingOptIn: row.marketing_opt_in,
    emailVerified: row.email_verified,
    suppressed: row.suppressed,
  };
}

/** The shop user with this email (any case), for a test send's unsubscribe link. */
export async function findUserIdByEmail(db: Executor, email: string): Promise<number | undefined> {
  const result = await db.execute<{ id: number }>(
    sql`select id from users where lower(email) = lower(${email}) limit 1`,
  );
  const [row] = result.rows;
  return row ? Number(row.id) : undefined;
}

export async function markNewsletterDeliverySent(
  db: Executor,
  id: number,
  messageId: string,
): Promise<void> {
  await db
    .update(newsletterDeliveries)
    .set({ status: "sent", sentAt: sql`now()`, messageId, error: null })
    .where(eq(newsletterDeliveries.id, id));
}

/** A failed attempt: queued again for a retry, or `failed` for good when `final`. */
export async function markNewsletterDeliveryFailed(
  db: Executor,
  id: number,
  { error, final }: { error: string; final: boolean },
): Promise<void> {
  await db
    .update(newsletterDeliveries)
    .set({ status: final ? "failed" : "queued", sentAt: sql`now()`, error })
    .where(eq(newsletterDeliveries.id, id));
}

/** Not sent, and never will be: the customer unsubscribed, isn't verified or is suppressed. */
export async function markNewsletterDeliverySkipped(
  db: Executor,
  id: number,
  reason: string,
): Promise<void> {
  await db
    .update(newsletterDeliveries)
    .set({ status: "skipped", error: reason })
    .where(eq(newsletterDeliveries.id, id));
}

/**
 * Marks each of these `sending` newsletters `sent` once none of its deliveries is queued; returns
 * the ones it finished.
 */
export async function finishNewsletters(
  db: Executor,
  newsletterIds: readonly number[],
): Promise<number[]> {
  if (newsletterIds.length === 0) return [];
  const rows = await db
    .update(newsletters)
    .set({ status: "sent", completedAt: sql`now()` })
    .where(
      and(
        inArray(newsletters.id, [...newsletterIds]),
        eq(newsletters.status, "sending"),
        sql`not exists (select 1 from ${newsletterDeliveries} d
          where d.newsletter_id = ${newsletters.id} and d.status = 'queued')`,
      ),
    )
    .returning({ id: newsletters.id });
  return rows.map((row) => row.id);
}
