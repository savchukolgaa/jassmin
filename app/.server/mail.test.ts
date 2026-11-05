import type Mail from "nodemailer/lib/mailer";
import { describe, expect, it, vi } from "vitest";
import {
  recipientAddresses,
  SuppressedRecipientError,
  smtpOptionsFromUrl,
  stripLineBreaks,
  withSuppressions,
} from "./mail";

describe("smtpOptionsFromUrl", () => {
  it("maps a plain smtp URL without credentials (smtp4dev)", () => {
    expect(smtpOptionsFromUrl("smtp://localhost:2525")).toMatchObject({
      host: "localhost",
      port: 2525,
      secure: false,
      auth: undefined,
    });
  });

  it("maps smtps with credentials and the default TLS port", () => {
    expect(smtpOptionsFromUrl("smtps://shop%40example.com:p%40ss@mail.example.com")).toMatchObject({
      host: "mail.example.com",
      port: 465,
      secure: true,
      auth: { user: "shop@example.com", pass: "p@ss" },
    });
  });

  it("defaults smtp to port 25", () => {
    expect(smtpOptionsFromUrl("smtp://mail.example.com").port).toBe(25);
  });
});

describe("stripLineBreaks", () => {
  it("turns CR/LF runs into single spaces", () => {
    expect(stripLineBreaks("Olha\r\nBcc: spam@example.com\nX")).toBe(
      "Olha Bcc: spam@example.com X",
    );
    expect(stripLineBreaks("Олена Коваль")).toBe("Олена Коваль");
  });
});

describe("recipientAddresses", () => {
  it("collects every to, cc and bcc address, lowercase", () => {
    expect(
      recipientAddresses({
        to: [{ name: "Olena", address: "Olena@Example.com" }, "Shop <shop@example.com>"],
        cc: "a@example.com, B <b@example.com>",
        bcc: [["nested@example.com"]] as unknown as Mail.Options["bcc"],
      }),
    ).toEqual([
      "olena@example.com",
      "shop@example.com",
      "a@example.com",
      "b@example.com",
      "nested@example.com",
    ]);
    expect(recipientAddresses({})).toEqual([]);
  });
});

describe("withSuppressions (#134)", () => {
  function setup(suppressed: Record<string, "hard_bounce" | "complaint">) {
    const sendMail = vi.fn(async (_options: Mail.Options) => ({ messageId: "<x@jassmin.ua>" }));
    const lookup = vi.fn(async (addresses: string[]) => {
      return new Map(
        addresses.flatMap((a) => (suppressed[a] ? [[a, suppressed[a]] as const] : [])),
      );
    });
    return { sendMail, lookup, mailer: withSuppressions({ sendMail }, lookup) };
  }

  it("sends unchanged when nobody is suppressed", async () => {
    const { sendMail, mailer } = setup({});
    const message = { to: "olena@example.com", subject: "Hi" };

    await expect(mailer.sendMail(message)).resolves.toEqual({ messageId: "<x@jassmin.ua>" });
    expect(sendMail).toHaveBeenCalledWith(message);
  });

  it("never sends to a suppressed address, whatever its case", async () => {
    const { sendMail, mailer } = setup({ "olena@example.com": "hard_bounce" });

    const sending = mailer.sendMail({ to: { name: "Olena", address: "Olena@Example.COM" } });

    await expect(sending).rejects.toBeInstanceOf(SuppressedRecipientError);
    await expect(sending).rejects.toMatchObject({ reasons: ["hard_bounce"] });
    await expect(sending).rejects.not.toThrow(/olena/i);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("drops only the suppressed recipients of a message to several", async () => {
    const { sendMail, mailer } = setup({ "spam@example.com": "complaint" });

    await mailer.sendMail({
      to: ["spam@example.com", "ok@example.com"],
      cc: "Spam <spam@example.com>",
      subject: "Hi",
    });

    expect(sendMail).toHaveBeenCalledWith({ to: ["ok@example.com"], subject: "Hi" });
  });

  it("doesn't look anything up for a message without recipients", async () => {
    const { lookup, mailer } = setup({});

    await mailer.sendMail({ subject: "nobody" });
    expect(lookup).not.toHaveBeenCalled();
  });
});
