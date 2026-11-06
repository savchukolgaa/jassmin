// `pnpm db:send-cart-reminders` (#139): one reminder email per abandoned cart, for registered
// users who agreed to marketing email. Each run queues the eligible carts (`queueCartReminders`:
// consent, at most one reminder per user every 7 days, nothing ordered since, something still
// available, abandoned in the last 72 hours) in the `order_emails` outbox, then sends them right
// away. `pnpm db:send-order-emails` retries the ones that failed, and checks the rules again
// first. Run it hourly from an external scheduler; the CLI wrapper is
// scripts/send-cart-reminders.ts.
//
// Without an SMTP server, `PUBLIC_SITE_URL` or `EMAIL_UNSUBSCRIBE_SECRET` it queues nothing, so
// reminders never pile up and go out days late once it is configured.
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
import { queueCartReminders } from "./queries/cart-reminders";

export interface CartReminderJobResult {
  /** The carts whose reminder this run queued. */
  queued: number[];
  /** How sending went; `null` when nothing was queued for lack of configuration. */
  report: OrderEmailReport | null;
  message: string;
}

/** Why the job can't send reminders with this configuration, or `undefined`. */
function missingConfig(mailer: MailSender | null, env: MailEnv): string | undefined {
  const missing = [
    mailer ? null : "SMTP_URL",
    env.PUBLIC_SITE_URL ? null : "PUBLIC_SITE_URL",
    env.EMAIL_UNSUBSCRIBE_SECRET ? null : "EMAIL_UNSUBSCRIBE_SECRET",
  ].filter(Boolean);
  return missing.length > 0 ? missing.join(", ") : undefined;
}

/** Queues and sends the due cart reminders; returns what it did and the message to log. */
export async function sendCartRemindersJob(
  db: Db,
  mailer: MailSender | null,
  env: MailEnv,
): Promise<CartReminderJobResult> {
  const missing = missingConfig(mailer, env);
  if (missing) {
    return {
      queued: [],
      report: null,
      message: `No cart reminders queued: ${missing} not set (see docs/email.md).`,
    };
  }
  const queued = await queueCartReminders(db);
  const report = await deliverOrderEmails(
    { type: "cart_reminder" },
    orderEmailDeps(db, mailer, env),
  );
  const carts = queued.length === 1 ? "reminder" : "reminders";
  return {
    queued,
    report,
    message: `Queued ${queued.length} cart ${carts}. ${describeOrderEmailReport(report)}`,
  };
}
