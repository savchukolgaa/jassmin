// `pnpm db:send-order-emails`: sends the queued order emails that are due (#45), retrying the
// ones that failed after checkout. Run it every 5 minutes from an external scheduler (cron).
// It needs the database and the mail variables (`SMTP_URL`, `ORDER_FROM`, …), not the web app's.
import { existsSync } from "node:fs";
import nodemailer from "nodemailer";
import { getDatabaseUrl, type MailEnv, parseMailEnv } from "../../env";
import { smtpOptionsFromUrl } from "../../mail";
import {
  deliverOrderEmails,
  describeOrderEmailReport,
  orderEmailDeps,
} from "../../services/order-email";
import { createDb } from "../client";

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
  const report = await deliverOrderEmails({}, orderEmailDeps(db, transport, env));
  console.log(describeOrderEmailReport(report));
} finally {
  transport?.close();
  await db.$client.end();
}
