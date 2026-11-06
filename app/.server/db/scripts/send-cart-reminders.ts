// `pnpm db:send-cart-reminders`: emails one reminder per abandoned cart to registered users who
// agreed to marketing email (#139). Run it hourly from an external scheduler (cron), after
// `pnpm db:mark-abandoned-carts`. It needs the database and the mail variables (`SMTP_URL`,
// `PUBLIC_SITE_URL`, `EMAIL_UNSUBSCRIBE_SECRET`, …), not the web app's.
import { existsSync } from "node:fs";
import nodemailer from "nodemailer";
import { getDatabaseUrl, type MailEnv, parseMailEnv } from "../../env";
import { smtpOptionsFromUrl, withSuppressions } from "../../mail";
import { sendCartRemindersJob } from "../cart-reminders";
import { createDb } from "../client";
import { findEmailSuppressions } from "../queries/email-suppressions";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

let env: MailEnv;
try {
  env = parseMailEnv(process.env);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const url = getDatabaseUrl(process.env);
if (!url) {
  console.error("Set DATABASE_URL (or JASSMINDB_URI) to the app database.");
  process.exit(1);
}

const transport = env.SMTP_URL
  ? nodemailer.createTransport(smtpOptionsFromUrl(env.SMTP_URL))
  : null;
const db = createDb(url, 1);
try {
  // Never to an address that bounced or complained (#134).
  const mailer = transport
    ? withSuppressions(transport, (addresses) => findEmailSuppressions(db, addresses))
    : null;
  const { message } = await sendCartRemindersJob(db, mailer, env);
  console.log(message);
} finally {
  transport?.close();
  await db.$client.end();
}
