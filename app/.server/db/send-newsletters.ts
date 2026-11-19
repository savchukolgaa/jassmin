// `pnpm db:send-newsletters` (#181): sends the queued newsletter deliveries, at most
// `NEWSLETTER_DAILY_LIMIT` in any 24 hours (what doesn't fit waits for a later run), skipping
// customers who unsubscribed, lost their verified address or were suppressed since the newsletter
// was queued. Run it every 15 minutes from cron; the CLI wrapper is scripts/send-newsletters.ts.
//
// Without an SMTP server, `PUBLIC_SITE_URL` or `EMAIL_UNSUBSCRIBE_SECRET` it sends nothing and the
// deliveries stay queued.
//
// It must not import `db/index.ts` (the CLI runs without the web app's env).
import type { MailSender } from "../mail";
import {
  deliverNewsletters,
  describeNewsletterReport,
  type NewsletterDeliveryReport,
  type NewsletterEnv,
} from "../services/newsletters";
import type { Db } from "./client";

export interface NewsletterJobResult {
  report: NewsletterDeliveryReport;
  message: string;
}

/** Sends the due newsletter deliveries; returns what it did and the message to log. */
export async function sendNewslettersJob(
  db: Db,
  mailer: MailSender | null,
  env: NewsletterEnv,
  now?: () => Date,
): Promise<NewsletterJobResult> {
  const report = await deliverNewsletters({ db, mailer, env, ...(now ? { now } : {}) });
  return { report, message: describeNewsletterReport(report) };
}
