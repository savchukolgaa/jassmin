import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ getUser: vi.fn() }));
const orders = vi.hoisted(() => ({ getOrderConfirmation: vi.fn() }));
const session = vi.hoisted(() => ({ getSessionOrderIds: vi.fn() }));
const payments = vi.hoisted(() => ({ getPaymentView: vi.fn() }));

vi.mock("~/.server/services/auth", () => auth);
vi.mock("~/.server/services/orders", () => orders);
vi.mock("~/.server/session", () => session);
vi.mock("~/.server/services/payments", () => payments);

type LoaderArgs = Parameters<typeof import("./checkout-success").loader>[0];

const load = async (orderId: string) => {
  const { loader } = await import("./checkout-success");
  const request = new Request(`http://localhost/checkout/success/${orderId}`);
  return loader({ request, params: { orderId }, context: {} } as unknown as LoaderArgs);
};

const confirmation = { id: 42, paymentMethod: "cod", lines: [] };

beforeEach(() => {
  vi.clearAllMocks();
  auth.getUser.mockResolvedValue(null);
  session.getSessionOrderIds.mockResolvedValue([]);
});

describe("checkout success loader", () => {
  it("shows a guest the order placed in their browser", async () => {
    session.getSessionOrderIds.mockResolvedValueOnce([42, 7]);
    orders.getOrderConfirmation.mockResolvedValueOnce(confirmation);

    expect(await load("42")).toEqual({ ...confirmation, payment: null });
    expect(orders.getOrderConfirmation).toHaveBeenCalledWith(42, {
      userId: null,
      orderIds: [42, 7],
    });
  });

  it("shows a logged-in user their order", async () => {
    auth.getUser.mockResolvedValueOnce({ id: 3 });
    orders.getOrderConfirmation.mockResolvedValueOnce(confirmation);

    expect(await load("42")).toEqual({ ...confirmation, payment: null });
    expect(orders.getOrderConfirmation).toHaveBeenCalledWith(42, { userId: 3, orderIds: [] });
  });

  it("adds a card order's payment state, and doesn't look it up for cash on delivery", async () => {
    session.getSessionOrderIds.mockResolvedValue([42]);
    orders.getOrderConfirmation.mockResolvedValueOnce({ ...confirmation, paymentMethod: "card" });
    payments.getPaymentView.mockResolvedValueOnce("failed");

    expect(await load("42")).toMatchObject({ paymentMethod: "card", payment: "failed" });
    expect(payments.getPaymentView).toHaveBeenCalledWith(42);

    payments.getPaymentView.mockClear();
    orders.getOrderConfirmation.mockResolvedValueOnce(confirmation);
    expect(await load("42")).toMatchObject({ payment: null });
    expect(payments.getPaymentView).not.toHaveBeenCalled();
  });

  it("answers 404 for someone else's order", async () => {
    orders.getOrderConfirmation.mockResolvedValueOnce(undefined);

    await expect(load("42")).rejects.toMatchObject({ init: { status: 404 } });
  });

  it("answers 404 for malformed or out-of-range ids without a lookup", async () => {
    for (const id of ["0", "-1", "abc", "1.5", "2147483648", "99999999999"]) {
      await expect(load(id)).rejects.toMatchObject({ init: { status: 404 } });
    }
    expect(orders.getOrderConfirmation).not.toHaveBeenCalled();
  });

  it("isn't indexed", async () => {
    const { meta } = await import("./checkout-success");
    type MetaArgs = Parameters<typeof meta>[0];
    const matches = [{ id: "root", loaderData: { locale: "en" } }];

    expect(meta({ matches } as unknown as MetaArgs)).toEqual([
      { title: "Order placed — Jassmin" },
      { name: "robots", content: "noindex, follow" },
    ]);
  });
});
