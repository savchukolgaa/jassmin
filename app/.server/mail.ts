import nodemailer, { type Transporter } from "nodemailer";
import type Mail from "nodemailer/lib/mailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import type { EmailSuppressionReason } from "~/lib/enums";
import { getEnv } from "./env";

// Outgoing email over SMTP (`SMTP_URL`). Locally that's smtp4dev, which catches every message
// and shows it in its web UI, so nothing leaves the machine.

const TIMEOUT_MS = 10_000;

/** The part of a nodemailer transport the mail services use, so tests can pass a fake. */
export interface MailSender {
  sendMail(options: Mail.Options): Promise<unknown>;
}

/** User input for a header (a name or subject): line breaks become spaces, so no header injection. */
export function stripLineBreaks(value: string): string {
  return value.replace(/[\r\n]+/g, " ");
}

/** SMTP options for an `smtp://` or `smtps://` URL (`smtps` = implicit TLS, default port 465). */
export function smtpOptionsFromUrl(smtpUrl: string): SMTPTransport.Options {
  const url = new URL(smtpUrl);
  const secure = url.protocol === "smtps:";
  const user = decodeURIComponent(url.username);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : secure ? 465 : 25,
    secure,
    auth: user ? { user, pass: decodeURIComponent(url.password) } : undefined,
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
  };
}

let transport: Transporter | null | undefined;

/** The shared SMTP transport, or `null` when `SMTP_URL` is not configured. */
export function getMailTransport(): Transporter | null {
  if (transport === undefined) {
    const { SMTP_URL } = getEnv();
    transport = SMTP_URL ? nodemailer.createTransport(smtpOptionsFromUrl(SMTP_URL)) : null;
  }
  return transport;
}

// Suppressions (#134): addresses that hard-bounced or complained get no more email. The lookup is
// passed in, so this module stays free of the database (the retry job brings its own pool).

/** Which of the addresses are suppressed, keyed by the lowercase address. */
export type SuppressionLookup = (
  addresses: string[],
) => Promise<ReadonlyMap<string, EmailSuppressionReason>>;

/** Every recipient of a message is suppressed, so it wasn't sent. Carries no address. */
export class SuppressedRecipientError extends Error {
  readonly reasons: EmailSuppressionReason[];

  constructor(reasons: EmailSuppressionReason[]) {
    super(`Not sent: every recipient is suppressed (${reasons.join(", ")})`);
    this.name = "SuppressedRecipientError";
    this.reasons = reasons;
  }
}

/** One recipient: `"Name <a@b.c>"`, `"a@b.c"` or `{ name, address }`. */
type Recipient = string | { name?: string; address: string };

/**
 * A recipient field as a flat list. nodemailer allows nested arrays and comma-separated strings;
 * both are split into single recipients.
 */
function recipientList(field: unknown): Recipient[] {
  if (Array.isArray(field)) return field.flatMap(recipientList);
  if (typeof field === "string") {
    return field
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  }
  if (typeof field === "object" && field !== null && "address" in field) {
    const { address, name } = field as { address: unknown; name?: unknown };
    if (typeof address === "string") {
      return [typeof name === "string" ? { name, address } : { address }];
    }
  }
  return [];
}

/** The bare, lowercase address of a recipient. */
export function recipientAddress(recipient: Recipient): string {
  const raw = typeof recipient === "string" ? recipient : recipient.address;
  const bracketed = raw.match(/<([^<>]+)>\s*$/);
  return (bracketed?.[1] ?? raw).trim().toLowerCase();
}

/** Every address a message goes to (`to`, `cc` and `bcc`), lowercase. */
export function recipientAddresses(options: Mail.Options): string[] {
  return [options.to, options.cc, options.bcc].flatMap(recipientList).map(recipientAddress);
}

const RECIPIENT_FIELDS = ["to", "cc", "bcc"] as const;

/**
 * `sender`, but never to a suppressed address: suppressed recipients are dropped, and when none
 * is left it throws `SuppressedRecipientError` without contacting the SMTP server.
 */
export function withSuppressions(sender: MailSender, lookup: SuppressionLookup): MailSender {
  return {
    async sendMail(options) {
      const addresses = recipientAddresses(options);
      if (addresses.length === 0) return sender.sendMail(options);
      const suppressed = await lookup(addresses);
      if (suppressed.size === 0) return sender.sendMail(options);

      const filtered: Mail.Options = { ...options };
      for (const field of RECIPIENT_FIELDS) {
        if (options[field] === undefined) continue;
        const kept = recipientList(options[field]).filter(
          (recipient) => !suppressed.has(recipientAddress(recipient)),
        );
        if (kept.length === 0) {
          delete filtered[field];
        } else {
          filtered[field] = kept;
        }
      }
      if (recipientAddresses(filtered).length === 0) {
        throw new SuppressedRecipientError([...new Set(suppressed.values())]);
      }
      return sender.sendMail(filtered);
    },
  };
}
