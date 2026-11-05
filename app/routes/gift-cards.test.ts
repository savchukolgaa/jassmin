import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ getUser: vi.fn() }));
const giftCards = vi.hoisted(() => ({ createGiftCard: vi.fn() }));
const payments = vi.hoisted(() => ({
  isCardPaymentAvailable: vi.fn(),
  startGiftCardPayment: vi.fn(),
}));
const session = vi.hoisted(() => ({ rememberGiftCard: vi.fn() }));

vi.mock("~/.server/services/auth", () => auth);
vi.mock("~/.server/services/gift-cards", () => giftCards);
vi.mock("~/.server/services/payments", () => payments);
vi.mock("~/.server/session", () => session);

type ActionArgs = Parameters<typeof import("./gift-cards").action>[0];
type LoaderArgs = Parameters<typeof import("./gift-cards").loader>[0];

function post(fields: Record<string, string>, path = "/podarunkovi-kartky"): ActionArgs {
  const request = new Request(`http://localhost${path}`, {
    method: "POST",
    body: new URLSearchParams(fields),
  });
  return { request, params: {}, context: {} } as unknown as ActionArgs;
}

/** A `data()` result's payload and status. */
function unwrap(result: unknown): { status: number; body: unknown } {
  const { data, init } = result as { data: unknown; init?: { status?: number } };
  return { status: init?.status ?? 200, body: data };
}

const providerUrl = "http://localhost/payments/simulator?data=abc&signature=def";

beforeEach(() => {
  vi.clearAllMocks();
  auth.getUser.mockResolvedValue(null);
  payments.isCardPaymentAvailable.mockReturnValue(true);
  giftCards.createGiftCard.mockResolvedValue(12);
  session.rememberGiftCard.mockResolvedValue("__jassmin_session=abc; Path=/");
  payments.startGiftCardPayment.mockResolvedValue({
    ok: true,
    redirectUrl: providerUrl,
    reference: "G12-1",
  });
});

describe("gift card page loader", () => {
  it("says whether card payment works and prefills a logged-in buyer's email", async () => {
    const { loader } = await import("./gift-cards");
    const args = {
      request: new Request("http://localhost/podarunkovi-kartky"),
      params: {},
      context: {},
    } as unknown as LoaderArgs;

    expect(await loader(args)).toEqual({ cardPaymentAvailable: true, prefillEmail: null });
    auth.getUser.mockResolvedValueOnce({ id: 3, email: "me@example.com" });
    payments.isCardPaymentAvailable.mockReturnValueOnce(false);
    expect(await loader(args)).toEqual({
      cardPaymentAvailable: false,
      prefillEmail: "me@example.com",
    });
  });
});

describe("gift card page action", () => {
  it("creates a pending card, remembers it and sends the buyer to the provider", async () => {
    const { action } = await import("./gift-cards");
    auth.getUser.mockResolvedValueOnce({ id: 3 });

    const response = (await action(
      post(
        { amount: "2000", email: " Me@Example.com ", recipientEmail: "friend@example.com" },
        "/en/gift-cards",
      ),
    )) as Response;

    expect(response.headers.get("Location")).toBe(providerUrl);
    expect(response.headers.get("Set-Cookie")).toContain("__jassmin_session=abc");
    expect(giftCards.createGiftCard).toHaveBeenCalledWith({
      amount: 2000,
      email: "me@example.com",
      recipientEmail: "friend@example.com",
      userId: 3,
      locale: "en",
    });
    expect(payments.startGiftCardPayment).toHaveBeenCalledWith({
      giftCardId: 12,
      locale: "en",
      origin: "http://localhost",
    });
  });

  it("leaves the recipient out when the field is blank", async () => {
    const { action } = await import("./gift-cards");
    await action(post({ amount: "500", email: "me@example.com", recipientEmail: "  " }));
    expect(giftCards.createGiftCard).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 500, recipientEmail: undefined, locale: "uk" }),
    );
  });

  it("refuses other amounts and bad emails with translated errors, creating nothing", async () => {
    const { action } = await import("./gift-cards");
    const result = unwrap(
      await action(post({ amount: "750", email: "nope", recipientEmail: "also nope" })),
    );
    expect(result).toEqual({
      status: 400,
      body: {
        fieldErrors: {
          amount: "giftCards.errors.amountRequired",
          email: "auth.errors.emailInvalid",
          recipientEmail: "auth.errors.emailInvalid",
        },
        values: { amount: "750", email: "nope", recipientEmail: "also nope" },
      },
    });
    expect(unwrap(await action(post({ email: "me@example.com" }))).body).toMatchObject({
      fieldErrors: { amount: "giftCards.errors.amountRequired" },
    });
    expect(giftCards.createGiftCard).not.toHaveBeenCalled();
  });

  it("doesn't sell cards without card payment", async () => {
    const { action } = await import("./gift-cards");
    payments.isCardPaymentAvailable.mockReturnValue(false);
    expect(unwrap(await action(post({ amount: "1000", email: "me@example.com" })))).toMatchObject({
      status: 400,
      body: { formError: "giftCards.unavailable" },
    });
    expect(giftCards.createGiftCard).not.toHaveBeenCalled();
  });

  it("goes to the card's page when the payment can't start", async () => {
    const { action } = await import("./gift-cards");
    payments.startGiftCardPayment.mockResolvedValueOnce({ ok: false, error: "unavailable" });
    const response = (await action(post({ amount: "1000", email: "me@example.com" }))) as Response;
    expect(response.headers.get("Location")).toBe("/podarunkovi-kartky/uspikh/12");
    expect(response.headers.get("Set-Cookie")).toContain("__jassmin_session=abc");
  });
});
