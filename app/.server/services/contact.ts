import type Mail from "nodemailer/lib/mailer";
import type { ContactMessage } from "~/features/home/contact-form.schema";
import { type Env, getEnv } from "../env";
import { getMailTransport, type MailSender, stripLineBreaks } from "../mail";
import { appRateLimitStore, createRateLimiter, type RateLimiter } from "../rate-limit";

// Contact form submissions from the home page: spam checks, rate limiting and delivery by email
// to the store (`CONTACT_INBOX`). Messages are not stored.

export const CONTACT_RATE_LIMIT = { limit: 5, windowMs: 10 * 60_000 } as const;

export interface ContactDeps {
  /** `null` when `SMTP_URL` is not configured. */
  mailer: MailSender | null;
  limiter: RateLimiter;
  env: Pick<Env, "CONTACT_INBOX" | "CONTACT_FROM" | "NODE_ENV">;
  now: () => Date;
}

export interface ContactSubmission {
  message: ContactMessage;
  /** The hidden honeypot field was filled in, so this is almost certainly a bot. */
  honeypot: boolean;
  /** Rate-limit key: `getClientIp(request) ?? "anonymous"`. */
  clientKey: string;
}

export type ContactSubmitResult =
  | { status: "sent" }
  /** Honeypot hit: report success to the bot but send nothing. */
  | { status: "ignored" }
  | { status: "rate_limited"; retryAfterSeconds: number }
  | { status: "delivery_failed" };

// Shared by every instance and kept across restarts (#143).
const contactLimiter: RateLimiter = createRateLimiter({
  name: "contact",
  ...CONTACT_RATE_LIMIT,
  store: appRateLimitStore,
});

function defaultDeps(): ContactDeps {
  return {
    mailer: getMailTransport(),
    limiter: contactLimiter,
    env: getEnv(),
    now: () => new Date(),
  };
}

/** The plain-text email the store receives; replying goes straight to the visitor. */
export function buildContactEmail(
  message: ContactMessage,
  env: ContactDeps["env"],
  receivedAt: Date,
): Mail.Options {
  const name = stripLineBreaks(message.name);
  return {
    from: env.CONTACT_FROM,
    to: env.CONTACT_INBOX,
    replyTo: { name, address: message.email },
    subject: `New message from ${name} — jassmin.ua`,
    text: [
      `Name: ${name}`,
      `Email: ${message.email}`,
      `Received: ${receivedAt.toISOString()}`,
      "",
      message.message,
    ].join("\n"),
  };
}

/** Sends the message to the store. Returns `false` when it could not be delivered. */
export async function deliverContactMessage(
  message: ContactMessage,
  { mailer, env, now }: Pick<ContactDeps, "mailer" | "env" | "now">,
): Promise<boolean> {
  const email = buildContactEmail(message, env, now());
  if (!mailer) {
    if (env.NODE_ENV === "production") {
      console.error("[contact] SMTP_URL is not set; contact message could not be delivered");
      return false;
    }
    console.info("[contact] SMTP_URL is not set; logging the message instead:\n", email.text);
    return true;
  }
  try {
    await mailer.sendMail(email);
    return true;
  } catch (error) {
    console.error("[contact] Sending the contact email failed:", error);
    return false;
  }
}

/** Handles one validated contact form submission. */
export async function submitContactMessage(
  { message, honeypot, clientKey }: ContactSubmission,
  deps: ContactDeps = defaultDeps(),
): Promise<ContactSubmitResult> {
  if (honeypot) {
    return { status: "ignored" };
  }
  if (await deps.limiter.isBlocked(clientKey)) {
    // The limiter doesn't expose when the window ends, so report the whole window as the upper bound.
    return { status: "rate_limited", retryAfterSeconds: CONTACT_RATE_LIMIT.windowMs / 1000 };
  }
  await deps.limiter.hit(clientKey);
  return (await deliverContactMessage(message, deps))
    ? { status: "sent" }
    : { status: "delivery_failed" };
}
