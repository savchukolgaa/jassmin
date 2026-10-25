import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSimulator } from "~/.server/payments/simulator";

const SECRET = "s".repeat(32);
const ORIGIN = "http://localhost:5173";

const env = vi.hoisted(() => ({
  getEnv: vi.fn(() => ({
    PAYMENT_PROVIDER: "simulator" as "simulator" | undefined,
    SESSION_SECRET: "s".repeat(32),
  })),
}));

vi.mock("~/.server/env", () => env);

type LoaderArgs = Parameters<typeof import("./payments.simulator").loader>[0];
type ActionArgs = Parameters<typeof import("./payments.simulator").action>[0];

const simulator = createSimulator(SECRET);

/** The signed `data` and `signature` checkout would send the shopper here with. */
function signedCheckout(overrides: { resultUrl?: string; callbackUrl?: string } = {}) {
  const { redirectUrl } = simulator.createCheckout({
    reference: "42-1",
    amount: "2450.00",
    currency: "UAH",
    description: "Замовлення №42 в Jassmin",
    resultUrl: overrides.resultUrl ?? `${ORIGIN}/checkout/success/42`,
    callbackUrl: overrides.callbackUrl ?? `${ORIGIN}/payments/callback`,
    locale: "uk",
  });
  const params = new URL(redirectUrl).searchParams;
  return { data: params.get("data") ?? "", signature: params.get("signature") ?? "" };
}

async function load(query: Record<string, string>) {
  const { loader } = await import("./payments.simulator");
  const request = new Request(`${ORIGIN}/payments/simulator?${new URLSearchParams(query)}`);
  return loader({ request, params: {}, context: {} } as unknown as LoaderArgs);
}

async function submit(fields: Record<string, string>) {
  const { action } = await import("./payments.simulator");
  const request = new Request(`${ORIGIN}/payments/simulator`, {
    method: "POST",
    body: new URLSearchParams(fields),
  });
  return action({ request, params: {}, context: {} } as unknown as ActionArgs);
}

const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response("OK"));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("payment simulator loader", () => {
  it("shows the signed attempt", async () => {
    const signed = signedCheckout();
    expect(await load(signed)).toEqual({
      reference: "42-1",
      amount: "2450.00",
      description: "Замовлення №42 в Jassmin",
      ...signed,
    });
  });

  it("answers 400 for a tampered or missing checkout", async () => {
    const signed = signedCheckout();
    await expect(load({ ...signed, signature: "forged" })).rejects.toMatchObject({
      init: { status: 400 },
    });
    await expect(load({})).rejects.toMatchObject({ init: { status: 400 } });
  });

  it("answers 404 unless the simulator is the configured provider", async () => {
    env.getEnv.mockReturnValueOnce({ PAYMENT_PROVIDER: undefined, SESSION_SECRET: SECRET });
    await expect(load(signedCheckout())).rejects.toMatchObject({ init: { status: 404 } });
  });
});

describe("payment simulator action", () => {
  /** The callbacks the action posted, as their decoded `status` and the raw body. */
  function sentCallbacks() {
    return fetchMock.mock.calls.map(([url, init]) => {
      const body = new URLSearchParams(String(init.body));
      return { url, body: body.toString(), form: body };
    });
  }

  it("posts a signed success callback and returns the shopper to the success page", async () => {
    const response = await submit({ ...signedCheckout(), outcome: "success" });

    expect(response).toBeInstanceOf(Response);
    expect((response as Response).headers.get("Location")).toBe("/checkout/success/42");
    const [sent] = sentCallbacks();
    expect(sent?.url).toBe(`${ORIGIN}/payments/callback`);
    const form = new FormData();
    form.set("data", sent?.form.get("data") ?? "");
    form.set("signature", sent?.form.get("signature") ?? "");
    expect(simulator.parseCallback(form)).toMatchObject({
      ok: true,
      event: { reference: "42-1", outcome: "success", amount: "2450.00" },
    });
  });

  it("sends the identical callback twice for the idempotency check", async () => {
    await submit({ ...signedCheckout(), outcome: "success-twice" });

    const sent = sentCallbacks();
    expect(sent).toHaveLength(2);
    expect(sent[0]?.body).toBe(sent[1]?.body);
  });

  it("posts a failure callback when declined, and nothing when the shopper leaves", async () => {
    await submit({ ...signedCheckout(), outcome: "failure" });
    const form = new FormData();
    form.set("data", sentCallbacks()[0]?.form.get("data") ?? "");
    form.set("signature", sentCallbacks()[0]?.form.get("signature") ?? "");
    expect(simulator.parseCallback(form)).toMatchObject({
      ok: true,
      event: { outcome: "failure" },
    });

    fetchMock.mockClear();
    const response = await submit({ ...signedCheckout(), outcome: "leave" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect((response as Response).headers.get("Location")).toBe("/checkout/success/42");
  });

  it("still returns the shopper when the callback fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockRejectedValueOnce(new Error("connection refused"));

    const response = await submit({ ...signedCheckout(), outcome: "success" });

    expect((response as Response).headers.get("Location")).toBe("/checkout/success/42");
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("rejects an unknown outcome, a tampered checkout and URLs on other sites", async () => {
    const invalid = await submit({ ...signedCheckout(), outcome: "refund" });
    expect(invalid).toMatchObject({ init: { status: 400 }, data: { error: "invalid-form" } });

    const tampered = await submit({ ...signedCheckout(), signature: "forged", outcome: "success" });
    expect(tampered).toMatchObject({ init: { status: 400 }, data: { error: "invalid-checkout" } });

    for (const overrides of [
      { resultUrl: "https://evil.example/checkout/success/42" },
      { callbackUrl: "https://evil.example/payments/callback" },
    ]) {
      const response = await submit({ ...signedCheckout(overrides), outcome: "success" });
      expect(response).toMatchObject({ data: { error: "invalid-checkout" } });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
