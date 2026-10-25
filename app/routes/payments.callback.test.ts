import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PaymentCallbackResult } from "~/.server/services/payments";

const handlePaymentCallback = vi.hoisted(() =>
  vi.fn(async (_form: FormData): Promise<PaymentCallbackResult> => ({ ok: true, result: "paid" })),
);

vi.mock("~/.server/services/payments", () => ({ handlePaymentCallback }));

type ActionArgs = Parameters<typeof import("./payments.callback").action>[0];

function post(body: BodyInit): ActionArgs {
  const request = new Request("http://localhost/payments/callback", { method: "POST", body });
  return { request, params: {}, context: {} } as unknown as ActionArgs;
}

function callbackBody(): URLSearchParams {
  return new URLSearchParams({ data: "ZGF0YQ==", signature: "c2ln" });
}

describe("payments callback route", () => {
  beforeEach(() => {
    handlePaymentCallback.mockClear();
  });

  it("passes the form to the payments service and answers 200 for a verified callback", async () => {
    const { action } = await import("./payments.callback");

    const response = await action(post(callbackBody()));

    expect(response.status).toBe(200);
    const form = handlePaymentCallback.mock.calls[0]?.[0];
    expect(form?.get("data")).toBe("ZGF0YQ==");
    expect(form?.get("signature")).toBe("c2ln");
  });

  it("answers 200 for an ignored repeat too, so the provider stops retrying", async () => {
    handlePaymentCallback.mockResolvedValueOnce({ ok: true, result: "ignored" });
    const { action } = await import("./payments.callback");

    expect((await action(post(callbackBody()))).status).toBe(200);
  });

  it("rejects an invalid signature or a malformed body with a 400", async () => {
    const { action } = await import("./payments.callback");

    handlePaymentCallback.mockResolvedValueOnce({ ok: false, error: "invalid-signature" });
    expect((await action(post(callbackBody()))).status).toBe(400);
    handlePaymentCallback.mockResolvedValueOnce({ ok: false, error: "malformed" });
    expect((await action(post(callbackBody()))).status).toBe(400);
  });

  it("rejects a body that isn't a form without calling the service", async () => {
    const { action } = await import("./payments.callback");
    const request = new Request("http://localhost/payments/callback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    const response = await action({ request, params: {}, context: {} } as unknown as ActionArgs);

    expect(response.status).toBe(400);
    expect(handlePaymentCallback).not.toHaveBeenCalled();
  });

  it("answers 404 when card payment isn't configured", async () => {
    handlePaymentCallback.mockResolvedValueOnce({ ok: false, error: "unavailable" });
    const { action } = await import("./payments.callback");

    expect((await action(post(callbackBody()))).status).toBe(404);
  });

  it("only redirects home on GET", async () => {
    const { loader } = await import("./payments.callback");

    expect(loader().headers.get("Location")).toBe("/");
    expect(handlePaymentCallback).not.toHaveBeenCalled();
  });
});
