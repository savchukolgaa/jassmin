// `pnpm db:send-tester-followups` (#191): one email per delivered tester order, about
// `TESTER_FOLLOWUP_DAYS` after delivery, to registered customers who agreed to marketing email,
// with a personal code for `TESTER_FOLLOWUP_PERCENT` % off a full bottle of the perfumes they
// tried. Each run queues the due orders (`queueTesterFollowups`, see its rules) in the
// `order_emails` outbox, each with its discount, then sends them right away. `pnpm
// db:send-order-emails` retries the ones that failed, and checks the rules again first. Run it
// daily from the scheduler; the CLI wrapper is scripts/send-tester-followups.ts.
//
// Without an SMTP server, `PUBLIC_SITE_URL` or `EMAIL_UNSUBSCRIBE_SECRET` it queues nothing, so
// no code is created for an email that can't go out.
//
// It must not import `db/index.ts` (the CLI runs without the web app's env).
import type { MailEnv } from "../env";
import type { MailSender } from "../mail";
import {
  deliverOrderEmails,
  describeOrderEmailReport,
  type OrderEmailReport,
  orderEmailDeps,
} from "../services/order-email";
import type { Db } from "./client";
import { queueTesterFollowups } from "./queries/tester-followups";

export interface TesterFollowupJobResult {
  /** The orders whose follow-up this run queued. */
  queued: number[];
  /** How sending went; `null` when nothing was queued for lack of configuration. */
  report: OrderEmailReport | null;
  message: string;
}

/** Why the job can't send follow-ups with this configuration, or `undefined`. */
function missingConfig(mailer: MailSender | null, env: MailEnv): string | undefined {
  const missing = [
    mailer ? null : "SMTP_URL",
    env.PUBLIC_SITE_URL ? null : "PUBLIC_SITE_URL",
    env.EMAIL_UNSUBSCRIBE_SECRET ? null : "EMAIL_UNSUBSCRIBE_SECRET",
  ].filter(Boolean);
  return missing.length > 0 ? missing.join(", ") : undefined;
}

/** Queues and sends the due tester follow-ups; returns what it did and the message to log. */
export async function sendTesterFollowupsJob(
  db: Db,
  mailer: MailSender | null,
  env: MailEnv,
  now: Date = new Date(),
): Promise<TesterFollowupJobResult> {
  const missing = missingConfig(mailer, env);
  if (missing) {
    return {
      queued: [],
      report: null,
      message: `No tester follow-ups queued: ${missing} not set (see docs/email.md).`,
    };
  }
  const queued = await queueTesterFollowups(db, {
    days: env.TESTER_FOLLOWUP_DAYS,
    percent: env.TESTER_FOLLOWUP_PERCENT,
    now,
  });
  const report = await deliverOrderEmails(
    { type: "tester_followup" },
    orderEmailDeps(db, mailer, env),
  );
  const followups = queued.length === 1 ? "follow-up" : "follow-ups";
  return {
    queued,
    report,
    message: `Queued ${queued.length} tester ${followups}. ${describeOrderEmailReport(report)}`,
  };
}
