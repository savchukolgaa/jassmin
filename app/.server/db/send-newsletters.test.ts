import { describe, expect, it, vi } from "vitest";
import type { NewsletterEnv } from "../services/newsletters";

const env: NewsletterEnv = {
  CONTACT_INBOX: "hello@jassmin.ua",
  CONTACT_FROM: "Jassmin <no-reply@jassmin.ua>",
  PUBLIC_SITE_URL: "https://jassmin.ua",
  EMAIL_UNSUBSCRIBE_SECRET: "n".repeat(32),
  NEWSLETTER_DAILY_LIMIT: 200,
};

describe("sendNewslettersJob", () => {
  it("sends nothing without SMTP, the site URL or the unsubscribe secret, and says why", async () => {
    const { sendNewslettersJob } = await import("./send-newsletters");
    const db = {} as Parameters<typeof sendNewslettersJob>[0];
    const sendMail = vi.fn();

    expect((await sendNewslettersJob(db, null, env)).message).toBe(
      "No newsletters sent: SMTP_URL not set (see docs/email.md).",
    );
    const bare = { ...env, PUBLIC_SITE_URL: undefined, EMAIL_UNSUBSCRIBE_SECRET: undefined };
    expect((await sendNewslettersJob(db, { sendMail }, bare)).message).toBe(
      "No newsletters sent: PUBLIC_SITE_URL, EMAIL_UNSUBSCRIBE_SECRET not set (see docs/email.md).",
    );
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("describes a run", async () => {
    const { describeNewsletterReport } = await import("../services/newsletters");
    expect(
      describeNewsletterReport({
        sent: 3,
        retrying: 1,
        failed: 0,
        skipped: 2,
        limitReached: true,
        finished: [4],
        notConfigured: null,
      }),
    ).toBe(
      "Sent 3 newsletter emails, 1 to retry, 0 failed, 2 skipped. Finished newsletter 4. NEWSLETTER_DAILY_LIMIT reached; the rest goes out in a later run.",
    );
  });
});
