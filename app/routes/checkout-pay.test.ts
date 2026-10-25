import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ getUser: vi.fn() }));
const payments = vi.hoisted(() => ({ startPayment: vi.fn() }));
const session = vi.hoisted(() => ({ getSessionOrderIds: vi.fn() }));

vi.mock("~/.server/services/auth", () => auth);
vi.mock("~/.server/services/payments", () => payments);
vi.mock("~/.server/session", () => session);

type ActionArgs = Parameters<typeof import("./checkout-pay").action>[0];
type LoaderArgs = Parameters<typeof import("./checkout-pay").loader>[0];

const providerUrl = "http://localhost/payments/simulator?data=abc&signature=def";

async function pay(orderId: string) {
  const { action } = await import("./checkout-pay");
  const request = new Request(`http://localhost/checkout/pay/${orderId}`, { method: "POST" });
  return action({ request, params: { orderId }, context: {} } as unknown as ActionArgs);
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.getUser.mockResolvedValue(null);
  session.getSessionOrderIds.mockResolvedValue([42]);
});

describe("checkout pay action", () => {
  it("starts a new attempt for the viewer's order and sends them to the provider", async () => {
    payments.startPayment.mockResolvedValueOnce({
      ok: true,
      redirectUrl: providerUrl,
      reference: "42-2",
    });

    const response = await pay("42");

    expect(response.headers.get("Location")).toBe(providerUrl);
    expect(payments.startPayment).toHaveBeenCalledWith({
      orderId: 42,
      locale: "uk",
      origin: "http://localhost",
      viewer: { userId: null, orderIds: [42] },
    });
  });

  it("passes a logged-in user as the viewer", async () => {
    auth.getUser.mockResolvedValueOnce({ id: 3 });
    session.getSessionOrderIds.mockResolvedValueOnce([]);
    payments.startPayment.mockResolvedValueOnce({
      ok: true,
      redirectUrl: providerUrl,
      reference: "42-2",
    });

    await pay("42");

    expect(payments.startPayment).toHaveBeenCalledWith(
      expect.objectContaining({ viewer: { userId: 3, orderIds: [] } }),
    );
  });

  it("answers 404 for someone else's order and for malformed ids", async () => {
    payments.startPayment.mockResolvedValueOnce({ ok: false, error: "not-found" });
    await expect(pay("42")).rejects.toMatchObject({ init: { status: 404 } });

    payments.startPayment.mockClear();
    await expect(pay("abc")).rejects.toMatchObject({ init: { status: 404 } });
    expect(payments.startPayment).not.toHaveBeenCalled();
  });

  it("goes back to the success page when the order can't be paid now", async () => {
    payments.startPayment.mockResolvedValueOnce({ ok: false, error: "not-payable" });
    expect((await pay("42")).headers.get("Location")).toBe("/checkout/success/42");

    payments.startPayment.mockResolvedValueOnce({ ok: false, error: "unavailable" });
    expect((await pay("42")).headers.get("Location")).toBe("/checkout/success/42");

    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    payments.startPayment.mockRejectedValueOnce(new Error("db down"));
    expect((await pay("42")).headers.get("Location")).toBe("/checkout/success/42");
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("checkout pay loader", () => {
  it("only redirects to the success page on GET", async () => {
    const { loader } = await import("./checkout-pay");
    const load = (orderId: string) =>
      loader({ params: { orderId } } as unknown as LoaderArgs).headers.get("Location");

    expect(load("42")).toBe("/checkout/success/42");
    expect(load("abc")).toBe("/");
    expect(payments.startPayment).not.toHaveBeenCalled();
  });
});
