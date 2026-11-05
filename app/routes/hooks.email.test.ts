import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailEvent } from "~/.server/email/webhook-brevo";

const SECRET = "w".repeat(32);

const env = vi.hoisted(() => ({ EMAIL_WEBHOOK_SECRET: "w".repeat(32) as string | undefined }));
const applyEmailEvents = vi.hoisted(() =>
  vi.fn(async (events: readonly EmailEvent[]) => ({ suppressed: events.length, bounced: 0 })),
);

vi.mock("~/.server/env", () => ({ getEnv: () => env }));
vi.mock("~/.server/services/email-webhook", () => ({ applyEmailEvents }));

type ActionArgs = Parameters<typeof import("./hooks.email").action>[0];

function post(body: string, authorization = `Bearer ${SECRET}`): ActionArgs {
  const request = new Request("http://localhost/hooks/email", {
    method: "POST",
    headers: { Authorization: authorization, "Content-Type": "application/json" },
    body,
  });
  return { request, params: {}, context: {} } as unknown as ActionArgs;
}

const hardBounce = {
  event: "hard_bounce",
  email: "olena@example.com",
  "message-id": "<1@jassmin.ua>",
  "X-Mailin-custom": "order-email:5",
  reason: "550 User unknown",
};

describe("/hooks/email", () => {
  beforeEach(() => {
    applyEmailEvents.mockClear();
    env.EMAIL_WEBHOOK_SECRET = SECRET;
  });

  it("records a hard bounce", async () => {
    const { action } = await import("./hooks.email");

    const response = await action(post(JSON.stringify(hardBounce)));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: 1, suppressed: 1, bounced: 0 });
    expect(applyEmailEvents).toHaveBeenCalledWith([
      {
        address: "olena@example.com",
        reason: "hard_bounce",
        detail: "550 User unknown",
        orderEmailId: 5,
        messageId: "<1@jassmin.ua>",
      },
    ]);
  });

  it("records a spam complaint from a batch, and ignores a soft bounce in it", async () => {
    const { action } = await import("./hooks.email");

    const response = await action(
      post(
        JSON.stringify([
          { event: "spam", email: "spam@example.com" },
          { event: "soft_bounce", email: "full@example.com" },
        ]),
      ),
    );

    expect(await response.json()).toEqual({ received: 2, suppressed: 1, bounced: 0 });
    expect(applyEmailEvents).toHaveBeenCalledWith([
      { address: "spam@example.com", reason: "complaint", detail: null },
    ]);
  });

  it("acknowledges an ignored event without recording anything", async () => {
    const { action } = await import("./hooks.email");

    const response = await action(
      post(JSON.stringify({ event: "delivered", email: "a@example.com" })),
    );

    expect(response.status).toBe(200);
    expect(applyEmailEvents).toHaveBeenCalledWith([]);
  });

  it("refuses a missing or wrong secret and records nothing", async () => {
    const { action } = await import("./hooks.email");

    for (const authorization of ["", "Bearer wrong", SECRET, `Bearer ${SECRET}x`]) {
      const response = await action(post(JSON.stringify(hardBounce), authorization));
      expect(response.status).toBe(401);
    }
    expect(applyEmailEvents).not.toHaveBeenCalled();
  });

  it("answers 503 when the app has no webhook secret", async () => {
    const { action } = await import("./hooks.email");
    env.EMAIL_WEBHOOK_SECRET = undefined;

    const response = await action(post(JSON.stringify(hardBounce)));

    expect(response.status).toBe(503);
    expect(applyEmailEvents).not.toHaveBeenCalled();
  });

  it("answers 400 for a body that isn't JSON and 422 for one that isn't an event", async () => {
    const { action } = await import("./hooks.email");

    expect((await action(post("{not json"))).status).toBe(400);
    const invalid = await action(post(JSON.stringify({ event: "hard_bounce" })));
    expect(invalid.status).toBe(422);
    expect(await invalid.json()).toEqual({ error: "invalid-input" });
    expect(applyEmailEvents).not.toHaveBeenCalled();
  });

  it("answers 405 to GET", async () => {
    const { loader } = await import("./hooks.email");

    const response = loader();
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
  });
});
