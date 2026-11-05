import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ getUser: vi.fn() }));
const giftCards = vi.hoisted(() => ({ getGiftCardView: vi.fn() }));
const payments = vi.hoisted(() => ({
  getGiftCardPaymentView: vi.fn(),
  startGiftCardPayment: vi.fn(),
}));
const session = vi.hoisted(() => ({ getSessionGiftCardIds: vi.fn() }));

vi.mock("~/.server/services/auth", () => auth);
vi.mock("~/.server/services/gift-cards", () => giftCards);
vi.mock("~/.server/services/payments", () => payments);
vi.mock("~/.server/session", () => session);

type LoaderArgs = Parameters<typeof import("./gift-card-success").loader>[0];
type ActionArgs = Parameters<typeof import("./gift-card-success").action>[0];

const path = (id: string) => `http://localhost/podarunkovi-kartky/uspikh/${id}`;

const load = async (giftCardId: string) => {
  const { loader } = await import("./gift-card-success");
  const request = new Request(path(giftCardId));
  return loader({ request, params: { giftCardId }, context: {} } as unknown as LoaderArgs);
};

const pay = async (giftCardId: string) => {
  const { action } = await import("./gift-card-success");
  const request = new Request(path(giftCardId), { method: "POST" });
  return action({ request, params: { giftCardId }, context: {} } as unknown as ActionArgs);
};

/** The thrown response's status. */
async function statusOf(promise: Promise<unknown>): Promise<number | undefined> {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  return (error as { init?: { status?: number } } | undefined)?.init?.status;
}

const card = { id: 12, status: "active", code: "ABCD2345EFGH6789" };

beforeEach(() => {
  vi.clearAllMocks();
  auth.getUser.mockResolvedValue(null);
  session.getSessionGiftCardIds.mockResolvedValue([12]);
  payments.getGiftCardPaymentView.mockResolvedValue("paid");
});

describe("gift card result loader", () => {
  it("shows the buyer their card and where its payment stands", async () => {
    giftCards.getGiftCardView.mockResolvedValueOnce(card);
    expect(await load("12")).toEqual({ card, payment: "paid" });
    expect(giftCards.getGiftCardView).toHaveBeenCalledWith(12, { userId: null, giftCardIds: [12] });
  });

  it("is a 404 for anyone else and for ids that can't be one", async () => {
    giftCards.getGiftCardView.mockResolvedValueOnce(undefined);
    expect(await statusOf(load("12"))).toBe(404);
    expect(await statusOf(load("abc"))).toBe(404);
    expect(giftCards.getGiftCardView).toHaveBeenCalledTimes(1);
  });
});

describe("gift card result action", () => {
  it("starts a new attempt for the buyer and sends them to the provider", async () => {
    auth.getUser.mockResolvedValueOnce({ id: 3 });
    payments.startGiftCardPayment.mockResolvedValueOnce({
      ok: true,
      redirectUrl: "http://localhost/payments/simulator?data=x&signature=y",
      reference: "G12-2",
    });

    const response = (await pay("12")) as Response;

    expect(response.headers.get("Location")).toBe(
      "http://localhost/payments/simulator?data=x&signature=y",
    );
    expect(payments.startGiftCardPayment).toHaveBeenCalledWith({
      giftCardId: 12,
      locale: "uk",
      origin: "http://localhost",
      viewer: { userId: 3, giftCardIds: [12] },
    });
  });

  it("is a 404 for a card that isn't the viewer's, and comes back here when it can't pay", async () => {
    payments.startGiftCardPayment.mockResolvedValueOnce({ ok: false, error: "not-found" });
    expect(await statusOf(pay("12"))).toBe(404);

    payments.startGiftCardPayment.mockResolvedValueOnce({ ok: false, error: "not-payable" });
    expect(((await pay("12")) as Response).headers.get("Location")).toBe(
      "/podarunkovi-kartky/uspikh/12",
    );
  });
});
