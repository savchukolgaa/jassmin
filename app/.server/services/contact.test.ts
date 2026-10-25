import nodemailer from "nodemailer";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MailSender } from "../mail";
import { createRateLimiter } from "../rate-limit";
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
    limiter: createRateLimiter({ limit: 2, windowMs: 60_000, now: () => 0 }),
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
  it("addresses the store, replies to the visitor and sends plain text", () => {
    expect(buildContactEmail(message, env, receivedAt)).toEqual({
      from: "Jassmin website <no-reply@example.com>",
      to: "shop@example.com",
      replyTo: { name: "Olha", address: "olha@example.com" },
      subject: "New message from Olha — jassmin.ua",
      text: [
        "Name: Olha",
        "Email: olha@example.com",
        "Received: 2026-10-23T10:00:00.000Z",
        "",
        "Do you have Chanel testers?",
      ].join("\n"),
    });
  });

  it("keeps line breaks out of the subject", () => {
    const email = buildContactEmail(
      { ...message, name: "Olha\r\nBcc: x@evil.test" },
      env,
      receivedAt,
    );

    expect(email.subject).toBe("New message from Olha Bcc: x@evil.test — jassmin.ua");
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
