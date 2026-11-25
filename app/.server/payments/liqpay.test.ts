import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createLiqPay,
  LIQPAY_API_VERSION,
  LIQPAY_CHECKOUT_URL,
  normaliseLiqPayAmount,
  signLiqPay,
  toLiqPayOutcome,
} from "./liqpay";
import type { CheckoutRequest } from "./provider";
import { getPaymentProvider } from "./provider";

const PUBLIC_KEY = "sandbox_i00000000";
const PRIVATE_KEY = `sandbox_${"p".repeat(40)}`;

const request: CheckoutRequest = {
  reference: "42-1",
  amount: "2450.00",
  currency: "UAH",
  description: "Замовлення Jassmin №42",
  resultUrl: "https://jassmin.ua/checkout/success/42",
  callbackUrl: "https://jassmin.ua/payments/callback",
  locale: "uk",
};

function encode(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

function decode(data: string): unknown {
  return JSON.parse(Buffer.from(data, "base64").toString("utf8"));
}

function form(fields: Record<string, string>): FormData {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  return body;
}

/** A callback LiqPay would send for the attempt, signed with `key`. */
function callback(
  overrides: Record<string, unknown> = {},
  { key = PRIVATE_KEY, digest = "sha3-256" as "sha3-256" | "sha1" } = {},
) {
  const data = encode({
    payment_id: 2_178_492_517,
    action: "pay",
    status: "success",
    version: 7,
    type: "buy",
    public_key: PUBLIC_KEY,
    order_id: "42-1",
    liqpay_order_id: "ABC123",
    description: "Замовлення Jassmin №42",
    amount: 2450,
    currency: "UAH",
    sender_card_mask2: "424242*42",
    ...overrides,
  });
  return form({ data, signature: signLiqPay(key, data, digest) });
}

const liqpay = createLiqPay({ publicKey: PUBLIC_KEY, privateKey: PRIVATE_KEY, sandbox: true });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("signLiqPay", () => {
  it("matches the worked example in LiqPay's checkout documentation", () => {
    // https://www.liqpay.ua/en/doc/api/internet_acquiring/checkout, "Формування запиту до API".
    const data = encode({
      public_key: "i00000000",
      version: 7,
      action: "pay",
      amount: "3",
      currency: "UAH",
      description: "test",
      order_id: "000001",
    });
    expect(signLiqPay("a4825234f4bae72a0be04eafe9e8e2bada209255", data)).toBe(
      "0adgJ8F2Ds5HCVkcz4AlmdLMRoIJf7IxsL3QmeFRz/s=",
    );
  });
});

describe("LiqPay checkout", () => {
  it("redirects to LiqPay's checkout with signed data for the attempt", () => {
    const url = new URL(liqpay.createCheckout(request).redirectUrl);
    const data = url.searchParams.get("data") ?? "";

    expect(`${url.origin}${url.pathname}`).toBe(LIQPAY_CHECKOUT_URL);
    expect(url.searchParams.get("signature")).toBe(signLiqPay(PRIVATE_KEY, data));
    expect(decode(data)).toEqual({
      version: LIQPAY_API_VERSION,
      public_key: PUBLIC_KEY,
      action: "pay",
      amount: 2450,
      currency: "UAH",
      description: "Замовлення Jassmin №42",
      order_id: "42-1",
      result_url: "https://jassmin.ua/checkout/success/42",
      server_url: "https://jassmin.ua/payments/callback",
      language: "uk",
      sandbox: 1,
    });
  });

  it("sends kopiyky exactly, English for English shoppers, and no sandbox flag when live", () => {
    const live = createLiqPay({ publicKey: PUBLIC_KEY, privateKey: PRIVATE_KEY, sandbox: false });
    const url = new URL(
      live.createCheckout({ ...request, amount: "999.50", locale: "en" }).redirectUrl,
    );
    const data = decode(url.searchParams.get("data") ?? "");

    expect(data).toMatchObject({ amount: 999.5, language: "en" });
    expect(data).not.toHaveProperty("sandbox");
  });

  it("puts the order prefix in front of the order id", () => {
    const prefixed = createLiqPay({
      publicKey: PUBLIC_KEY,
      privateKey: PRIVATE_KEY,
      sandbox: true,
      orderPrefix: "dev-",
    });
    const url = new URL(prefixed.createCheckout(request).redirectUrl);

    expect(decode(url.searchParams.get("data") ?? "")).toMatchObject({ order_id: "dev-42-1" });
  });
});

describe("LiqPay callback", () => {
  it("accepts a signed success and reports the amount as an exact decimal", () => {
    const parsed = liqpay.parseCallback(callback());

    expect(parsed).toEqual({
      ok: true,
      event: {
        reference: "42-1",
        outcome: "success",
        amount: "2450.00",
        currency: "UAH",
        providerPaymentId: "2178492517",
        raw: expect.objectContaining({ status: "success", sender_card_mask2: "424242*42" }),
      },
    });
  });

  it("also accepts LiqPay's legacy SHA-1 signature", () => {
    expect(liqpay.parseCallback(callback({}, { digest: "sha1" })).ok).toBe(true);
  });

  it("refuses a signature made with another key", () => {
    expect(liqpay.parseCallback(callback({}, { key: "someone-else" }))).toEqual({
      ok: false,
      error: "invalid-signature",
    });
  });

  it("refuses data changed after signing", () => {
    const body = callback();
    const tampered = encode({ ...(decode(String(body.get("data"))) as object), amount: 1 });
    body.set("data", tampered);

    expect(liqpay.parseCallback(body)).toEqual({ ok: false, error: "invalid-signature" });
  });

  it.each([
    ["no fields", form({})],
    ["no signature", form({ data: "e30=" })],
    [
      "data that isn't base64 JSON",
      form({ data: "%%%", signature: signLiqPay(PRIVATE_KEY, "%%%") }),
    ],
    ["a missing order id", callback({ order_id: undefined })],
    ["a non-numeric amount", callback({ amount: "lots" })],
    ["a negative amount", callback({ amount: -5 })],
    ["fractions of a kopiyka", callback({ amount: 10.005 })],
    ["another merchant's public key", callback({ public_key: "i99999999" })],
  ])("calls %s malformed", (_label, body) => {
    expect(liqpay.parseCallback(body)).toEqual({ ok: false, error: "malformed" });
  });

  it("strips the order prefix and refuses callbacks without it", () => {
    const prefixed = createLiqPay({
      publicKey: PUBLIC_KEY,
      privateKey: PRIVATE_KEY,
      sandbox: true,
      orderPrefix: "dev-",
    });

    const parsed = prefixed.parseCallback(callback({ order_id: "dev-42-1" }));
    expect(parsed.ok && parsed.event.reference).toBe("42-1");
    expect(prefixed.parseCallback(callback({ order_id: "42-1" }))).toEqual({
      ok: false,
      error: "malformed",
    });
    expect(prefixed.parseCallback(callback({ order_id: "dev-" }))).toEqual({
      ok: false,
      error: "malformed",
    });
  });

  it("passes a mismatched amount or currency on for the payments service to reject", () => {
    const parsed = liqpay.parseCallback(callback({ amount: 1, currency: "USD" }));

    expect(parsed.ok && [parsed.event.amount, parsed.event.currency]).toEqual(["1.00", "USD"]);
  });
});

describe("toLiqPayOutcome", () => {
  it.each([
    ["success", "success"],
    ["failure", "failure"],
    ["error", "failure"],
    ["reversed", "failure"],
    ["processing", "pending"],
    ["prepared", "pending"],
    ["wait_secure", "pending"],
    ["wait_accept", "pending"],
    ["3ds_verify", "pending"],
    ["otp_verify", "pending"],
  ] as const)("maps %s to %s", (status, outcome) => {
    expect(toLiqPayOutcome(status, { sandbox: false })).toBe(outcome);
  });

  it("counts LiqPay's sandbox status as paid only in sandbox mode", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(toLiqPayOutcome("sandbox", { sandbox: true })).toBe("success");
    expect(toLiqPayOutcome("sandbox", { sandbox: false })).toBe("pending");
    expect(warn).toHaveBeenCalledOnce();
  });

  it("logs an unknown status and keeps it pending, never paid", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(toLiqPayOutcome("something_new", { sandbox: true })).toBe("pending");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("something_new"));
  });
});

describe("normaliseLiqPayAmount", () => {
  it.each([
    [2450, "2450.00"],
    [2450.5, "2450.50"],
    [7.34, "7.34"],
    [0.1, "0.10"],
  ])("turns %s into %s", (amount, expected) => {
    expect(normaliseLiqPayAmount(amount)).toBe(expected);
  });

  it("refuses amounts that aren't whole kopiyky", () => {
    expect(normaliseLiqPayAmount(1.005)).toBeNull();
    expect(normaliseLiqPayAmount(-1)).toBeNull();
  });
});

describe("getPaymentProvider: liqpay", () => {
  const env = {
    PAYMENT_PROVIDER: "liqpay" as const,
    SESSION_SECRET: "s".repeat(32),
    LIQPAY_PUBLIC_KEY: PUBLIC_KEY,
    LIQPAY_PRIVATE_KEY: PRIVATE_KEY,
  };

  function sandboxFlag(provider: ReturnType<typeof getPaymentProvider>): unknown {
    const url = new URL(provider?.createCheckout(request).redirectUrl ?? "");
    return (decode(url.searchParams.get("data") ?? "") as { sandbox?: number }).sandbox;
  }

  it("is LiqPay, in sandbox mode outside production and live in production", () => {
    expect(getPaymentProvider(env)?.name).toBe("liqpay");
    expect(sandboxFlag(getPaymentProvider({ ...env, NODE_ENV: "development" }))).toBe(1);
    expect(sandboxFlag(getPaymentProvider({ ...env, NODE_ENV: "production" }))).toBeUndefined();
    expect(
      sandboxFlag(getPaymentProvider({ ...env, NODE_ENV: "production", LIQPAY_SANDBOX: true })),
    ).toBe(1);
  });

  it("refuses to build LiqPay without its keys", () => {
    expect(() => getPaymentProvider({ ...env, LIQPAY_PRIVATE_KEY: undefined })).toThrow(
      /LIQPAY_PRIVATE_KEY/,
    );
  });
});
