import { describe, expect, it } from "vitest";
import { toEmailEvents } from "./webhook-brevo";
import { brevoWebhookSchema } from "./webhook-brevo.schema";

/** A Brevo transactional event, as in their docs. */
const hardBounce = {
  event: "hard_bounce",
  email: "olena@example.com",
  id: 26224,
  date: "2026-11-05 10:00:00",
  ts: 1793872800,
  "message-id": "<9b1c@jassmin.ua>",
  ts_event: 1793872800,
  subject: "Замовлення №1042 прийнято — Jassmin",
  "X-Mailin-custom": "order-email:17",
  sending_ip: "185.41.28.109",
  reason: "550 5.1.1 User unknown",
};

function parse(body: unknown) {
  const parsed = brevoWebhookSchema.safeParse(body);
  if (!parsed.success) throw new Error("expected a valid body");
  return parsed.data;
}

describe("brevoWebhookSchema", () => {
  it("accepts one event or an array of them, keeping only the fields we use", () => {
    expect(parse(hardBounce)).toEqual([
      {
        event: "hard_bounce",
        email: "olena@example.com",
        "message-id": "<9b1c@jassmin.ua>",
        "X-Mailin-custom": "order-email:17",
        reason: "550 5.1.1 User unknown",
      },
    ]);
    expect(parse([hardBounce, { event: "delivered", email: "a@example.com" }])).toHaveLength(2);
  });

  it("refuses bodies that aren't Brevo events", () => {
    for (const body of [
      {},
      [],
      "hard_bounce",
      { event: "hard_bounce" },
      { event: "", email: "a@example.com" },
      { event: "spam", email: "no-at-sign" },
      { event: "spam", email: 42 },
    ]) {
      expect(brevoWebhookSchema.safeParse(body).success).toBe(false);
    }
  });
});

describe("toEmailEvents", () => {
  it("suppresses hard bounces, spam complaints, blocked and invalid addresses", () => {
    const events = toEmailEvents(
      parse([
        hardBounce,
        { event: "spam", email: "spam@example.com" },
        { event: "Blocked", email: "blocked@example.com", reason: "  " },
        { event: "invalid_email", email: "bad@@example" },
      ]),
    );
    expect(events).toEqual([
      {
        address: "olena@example.com",
        reason: "hard_bounce",
        detail: "550 5.1.1 User unknown",
        orderEmailId: 17,
        messageId: "<9b1c@jassmin.ua>",
      },
      { address: "spam@example.com", reason: "complaint", detail: null },
      { address: "blocked@example.com", reason: "blocked", detail: null },
      { address: "bad@@example", reason: "invalid", detail: null },
    ]);
  });

  it("ignores soft bounces, deliveries, opens and unknown events", () => {
    const ignored = [
      "soft_bounce",
      "deferred",
      "delivered",
      "opened",
      "click",
      "unsubscribed",
      "x",
    ];
    expect(
      toEmailEvents(parse(ignored.map((event) => ({ event, email: "a@example.com" })))),
    ).toEqual([]);
    // Inherited object keys aren't events either.
    expect(toEmailEvents(parse({ event: "constructor", email: "a@example.com" }))).toEqual([]);
  });

  it("leaves out a tag that isn't ours", () => {
    const [event] = toEmailEvents(parse({ ...hardBounce, "X-Mailin-custom": "newsletter:3" }));
    expect(event?.orderEmailId).toBeUndefined();
    expect(event?.messageId).toBe("<9b1c@jassmin.ua>");
  });
});
