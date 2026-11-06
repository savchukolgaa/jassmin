import nodemailer from "nodemailer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { htmlSection, htmlWords, words } from "../email/test-helpers";
import type { MailSender } from "../mail";
import { createMemoryRateLimitStore, createRateLimiter } from "../rate-limit";
import { buildContactEmail, type ContactDeps, submitContactMessage } from "./contact";

vi.mock("../env", () => ({ getEnv: () => ({}) }));
vi.mock("../mail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../mail")>()),
  getMailTransport: () => null,
}));

const message = {
  name: "Olha",
  email: "olha@example.com",
  message: "Do you have Chanel testers?",
};
const receivedAt = new Date("2026-10-23T10:00:00.000Z");
const env: ContactDeps["env"] = {
  CONTACT_INBOX: "shop@example.com",
  CONTACT_FROM: "Jassmin website <no-reply@example.com>",
  NODE_ENV: "development",
};

function deps(overrides: Partial<ContactDeps> = {}): ContactDeps {
  return {
    mailer: { sendMail: vi.fn(async () => ({})) },
    limiter: createRateLimiter({
      name: "contact",
      limit: 2,
      windowMs: 60_000,
      store: createMemoryRateLimitStore(),
      now: () => 0,
    }),
    env,
    now: () => receivedAt,
    ...overrides,
  };
}

const submission = { message, honeypot: false, clientKey: "203.0.113.7" };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildContactEmail", () => {
  it("addresses the store in Ukrainian and replies to the visitor", () => {
    const email = buildContactEmail(message, env, receivedAt);

    expect(email).toMatchObject({
      from: "Jassmin website <no-reply@example.com>",
      to: "shop@example.com",
      replyTo: { name: "Olha", address: "olha@example.com" },
      subject: "Нове повідомлення від Olha — jassmin.ua",
    });
    expect(String(email.text).split("\n\n-- \n")[0]).toBe(
      [
        "Повідомлення з форми на сайті",
        "Ім’я: Olha",
        "Email: olha@example.com",
        "Отримано: 2026-10-23T10:00:00.000Z",
        "",
        "Do you have Chanel testers?",
      ].join("\n"),
    );
  });

  it("uses the shared HTML layout and escapes the visitor's text (#134)", () => {
    const email = buildContactEmail(
      { ...message, name: "<b>Olha</b>", message: "Hi <script>x</script>\nsecond line" },
      env,
      receivedAt,
    );
    const html = String(email.html);
    const [body] = String(email.text).split("\n\n-- \n");

    expect(html).toContain('<html lang="uk">');
    expect(html).not.toContain("<script>");
    expect(html).toContain("Hi &lt;script&gt;x&lt;/script&gt;<br>second line");
    expect(html).toContain("&lt;b&gt;Olha&lt;/b&gt;");
    expect(htmlWords(htmlSection(html, "content"))).toEqual(words(body ?? ""));
    expect(email.messageId).toMatch(/@example\.com>$/);
  });

  it("keeps line breaks out of the subject", () => {
    const email = buildContactEmail(
      { ...message, name: "Olha\r\nBcc: x@evil.test" },
      env,
      receivedAt,
    );

    expect(email.subject).toBe("Нове повідомлення від Olha Bcc: x@evil.test — jassmin.ua");
  });

  it("produces a message a real nodemailer transport accepts", async () => {
    const transport: MailSender = nodemailer.createTransport({ jsonTransport: true });

    const info = await transport.sendMail(buildContactEmail(message, env, receivedAt));

    expect(JSON.stringify(info)).toContain("shop@example.com");
  });
});

describe("submitContactMessage", () => {
  it("emails the message to the store", async () => {
    const d = deps();

    await expect(submitContactMessage(submission, d)).resolves.toEqual({ status: "sent" });
    expect(d.mailer?.sendMail).toHaveBeenCalledOnce();
    expect(d.mailer?.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "shop@example.com", replyTo: expect.anything() }),
    );
  });

  it("ignores honeypot submissions without sending or counting them", async () => {
    const d = deps();

    await expect(submitContactMessage({ ...submission, honeypot: true }, d)).resolves.toEqual({
      status: "ignored",
    });
    expect(d.mailer?.sendMail).not.toHaveBeenCalled();
  });

  it("rate-limits a client after the limit", async () => {
    const d = deps();
    await submitContactMessage(submission, d);
    await submitContactMessage(submission, d);

    await expect(submitContactMessage(submission, d)).resolves.toEqual({
      status: "rate_limited",
      retryAfterSeconds: 600,
    });
    expect(d.mailer?.sendMail).toHaveBeenCalledTimes(2);
  });

  it("reports a delivery failure when SMTP fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const d = deps({
      mailer: {
        sendMail: vi.fn(async () => {
          throw new Error("ECONNREFUSED");
        }),
      },
    });

    await expect(submitContactMessage(submission, d)).resolves.toEqual({
      status: "delivery_failed",
    });
  });

  it("logs the message in development when SMTP isn't configured", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    await expect(submitContactMessage(submission, deps({ mailer: null }))).resolves.toEqual({
      status: "sent",
    });
    expect(info).toHaveBeenCalledWith(expect.any(String), expect.stringContaining("Chanel"));
  });

  it("fails in production when SMTP isn't configured", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      submitContactMessage(
        submission,
        deps({ mailer: null, env: { ...env, NODE_ENV: "production" } }),
      ),
    ).resolves.toEqual({ status: "delivery_failed" });
  });
});
