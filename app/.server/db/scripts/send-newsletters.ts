// `pnpm db:send-newsletters`: sends the queued newsletter deliveries (#181) within
// `NEWSLETTER_DAILY_LIMIT`, then pushes the newsletters' counts to Strapi when `STRAPI_SYNC_TOKEN`
// is set (otherwise `pnpm db:sync-cms` pushes them later). Run it every 15 minutes from cron. It
// needs the database and the mail variables (`SMTP_URL`, `PUBLIC_SITE_URL`,
// `EMAIL_UNSUBSCRIBE_SECRET`, …), not the web app's.
import { existsSync } from "node:fs";
import nodemailer from "nodemailer";
import { getDatabaseUrl, type MailEnv, parseCmsSyncEnv, parseMailEnv } from "../../env";
import { smtpOptionsFromUrl, withSuppressions } from "../../mail";
import { cmsSyncDeps, deliverCmsSync, describeCmsSyncReport } from "../../services/cms-push";
import { createDb } from "../client";
import { findEmailSuppressions } from "../queries/email-suppressions";
import { sendNewslettersJob } from "../send-newsletters";

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
  const { message } = await sendNewslettersJob(db, mailer, env);
  console.log(message);

  const cmsEnv = parseCmsSyncEnv(process.env);
  if (cmsEnv.STRAPI_SYNC_TOKEN) {
    console.log(describeCmsSyncReport(await deliverCmsSync({}, cmsSyncDeps(db, cmsEnv))));
  }
} finally {
  transport?.close();
  await db.$client.end();
}
