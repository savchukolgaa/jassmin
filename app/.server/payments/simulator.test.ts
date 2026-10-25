import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { CheckoutRequest } from "./provider";
import { getPaymentProvider } from "./provider";
import { createSimulator, SIMULATOR_PATH } from "./simulator";

const SECRET = "s".repeat(32);

const request: CheckoutRequest = {
  reference: "42-1",
  amount: "2450.00",
  currency: "UAH",
  description: "Jassmin order 42",
  resultUrl: "http://localhost:5173/checkout/success/42",
  callbackUrl: "http://localhost:5173/payments/callback",
  locale: "uk",
};

/** The `data` and `signature` query parameters of the hosted page URL. */
function checkoutParams(redirectUrl: string) {
  const url = new URL(redirectUrl);
  return {
    url,
    data: url.searchParams.get("data") ?? "",
    signature: url.searchParams.get("signature") ?? "",
  };
}

/** Signs `data` the way the simulator does, to forge payloads it would never build itself. */
function signAsSimulator(data: string): string {
  const key = createHmac("sha256", SECRET).update("payment-simulator").digest();
  return createHmac("sha256", key).update(data).digest("base64");
}

function form(fields: Record<string, string>): FormData {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  return body;
}

describe("getPaymentProvider", () => {
  it("is null without PAYMENT_PROVIDER and the simulator when it says so", () => {
    expect(getPaymentProvider({ PAYMENT_PROVIDER: undefined, SESSION_SECRET: SECRET })).toBeNull();
    expect(
      getPaymentProvider({ PAYMENT_PROVIDER: "simulator", SESSION_SECRET: SECRET })?.name,
    ).toBe("simulator");
  });
});

describe("simulator checkout", () => {
  it("points at the simulator page on the result URL's origin with signed attempt data", () => {
    const simulator = createSimulator(SECRET);
    const { url, data, signature } = checkoutParams(simulator.createCheckout(request).redirectUrl);

    expect(url.origin).toBe("http://localhost:5173");
    expect(url.pathname).toBe(SIMULATOR_PATH);
    expect(simulator.verifyCheckout(data, signature)).toEqual({
      reference: "42-1",
      amount: "2450.00",
      currency: "UAH",
      description: "Jassmin order 42",
      result_url: request.resultUrl,
      callback_url: request.callbackUrl,
      locale: "uk",
    });
  });

  it("rejects tampered data, a tampered signature and another secret's signature", () => {
    const simulator = createSimulator(SECRET);
    const { data, signature } = checkoutParams(simulator.createCheckout(request).redirectUrl);
    const cheaper = Buffer.from(
      Buffer.from(data, "base64").toString("utf8").replace("2450.00", "1.00"),
    ).toString("base64");

    expect(simulator.verifyCheckout(cheaper, signature)).toBeNull();
    expect(simulator.verifyCheckout(data, `${signature.slice(0, -2)}AA`)).toBeNull();
    expect(simulator.verifyCheckout(data, "short")).toBeNull();
    expect(createSimulator("o".repeat(32)).verifyCheckout(data, signature)).toBeNull();
  });
});

describe("simulator callback", () => {
  const simulator = createSimulator(SECRET);
  const { data, signature } = checkoutParams(simulator.createCheckout(request).redirectUrl);
  const checkout = simulator.verifyCheckout(data, signature);
  if (!checkout) throw new Error("checkout should verify");

  it("accepts its own signed success and failure callbacks", () => {
    const success = simulator.parseCallback(
      form({ ...simulator.buildCallback(checkout, "success") }),
    );
    expect(success).toMatchObject({
      ok: true,
      event: { reference: "42-1", outcome: "success", amount: "2450.00", currency: "UAH" },
    });
    expect(success.ok && success.event.providerPaymentId).toMatch(/^sim_/);
    expect(success.ok && success.event.raw).toMatchObject({ status: "success" });

    const failure = simulator.parseCallback(
      form({ ...simulator.buildCallback(checkout, "failure") }),
    );
    expect(failure).toMatchObject({ ok: true, event: { outcome: "failure" } });
  });

  it("rejects a callback with a wrong signature or tampered data", () => {
    const callback = simulator.buildCallback(checkout, "success");
    const other = createSimulator("o".repeat(32)).buildCallback(checkout, "success");

    expect(simulator.parseCallback(form({ data: callback.data, signature: "bad" }))).toEqual({
      ok: false,
      error: "invalid-signature",
    });
    expect(simulator.parseCallback(form({ ...other }))).toEqual({
      ok: false,
      error: "invalid-signature",
    });
    expect(
      simulator.parseCallback(form({ data: `${callback.data}x`, signature: callback.signature })),
    ).toEqual({ ok: false, error: "invalid-signature" });
  });

  it("calls a missing field or a signed payload of the wrong shape malformed", () => {
    expect(simulator.parseCallback(form({ data: "abc" }))).toEqual({
      ok: false,
      error: "malformed",
    });
    // Correctly signed with the simulator's key, but not a callback payload.
    const { data: checkoutData, signature: checkoutSignature } = checkoutParams(
      simulator.createCheckout(request).redirectUrl,
    );
    expect(
      simulator.parseCallback(form({ data: checkoutData, signature: checkoutSignature })),
    ).toEqual({ ok: false, error: "malformed" });
  });

  it("treats statuses other than success and failure as pending", () => {
    const callback = simulator.buildCallback(checkout, "success");
    const payload = JSON.parse(Buffer.from(callback.data, "base64").toString("utf8"));
    const data = Buffer.from(JSON.stringify({ ...payload, status: "processing" })).toString(
      "base64",
    );

    expect(simulator.parseCallback(form({ data, signature: signAsSimulator(data) }))).toMatchObject(
      { ok: true, event: { outcome: "pending" } },
    );
  });
});
