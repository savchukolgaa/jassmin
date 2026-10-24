import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CartLine } from "~/lib/cart";

const cart = vi.hoisted(() => ({
  getActiveCartId: vi.fn(),
  getCartOwner: vi.fn(),
  getCartView: vi.fn(),
}));
const orders = vi.hoisted(() => ({ createOrder: vi.fn(), getCheckoutPrefill: vi.fn() }));
const session = vi.hoisted(() => ({ rememberOrder: vi.fn() }));

vi.mock("~/.server/services/cart", () => cart);
vi.mock("~/.server/services/orders", () => orders);
vi.mock("~/.server/session", () => session);

type ActionArgs = Parameters<typeof import("./checkout").action>[0];
type LoaderArgs = Parameters<typeof import("./checkout").loader>[0];

const guest = { userId: null, anonymousId: "0b6f1b8e-3f7e-4a52-9a43-3c1f7f1f2c11" };

const line: CartLine = {
  variantId: "01a1652b-6e25-7d00-8000-000000000050",
  productId: "01a1652b-6e25-7c03-ae47-25b57131fb06",
  title: "Coco Mademoiselle",
  brand: "Chanel",
  imageUrl: null,
  packSize: 1,
  volumeMl: 30,
  unitPrice: "450.00",
  quantity: 2,
  stockQuantity: 3,
  lineTotal: "900.00",
};

const valid = {
  fullName: "Олена Коваль",
  email: "olena@example.com",
  phone: "067 123 45 67",
  city: "Київ",
  branch: "Відділення №12",
  paymentMethod: "cod",
};

function get(): LoaderArgs {
  const request = new Request("http://localhost/checkout");
  return { request, params: {}, context: {} } as unknown as LoaderArgs;
}

function post(fields: Record<string, string>): ActionArgs {
  const request = new Request("http://localhost/checkout", {
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

/** The thrown or returned redirect's target. */
async function redirectOf(promise: Promise<unknown>): Promise<string | null> {
  const result = await promise.catch((error: unknown) => error);
  return result instanceof Response ? result.headers.get("Location") : null;
}

beforeEach(() => {
  vi.clearAllMocks();
  cart.getCartOwner.mockResolvedValue(guest);
  cart.getActiveCartId.mockResolvedValue(5);
  session.rememberOrder.mockResolvedValue("__jassmin_session=abc; Path=/");
});

describe("checkout loader", () => {
  it("sends the visitor back to the cart when it's empty or a line exceeds stock", async () => {
    const { loader } = await import("./checkout");

    cart.getCartView.mockResolvedValueOnce({ lines: [], itemCount: 0, subtotal: "0.00" });
    expect(await redirectOf(loader(get()))).toBe("/cart");

    cart.getCartView.mockResolvedValueOnce({
      lines: [{ ...line, quantity: 4 }],
      itemCount: 4,
      subtotal: "1800.00",
    });
    expect(await redirectOf(loader(get()))).toBe("/cart");
  });

  it("returns the cart, how much is missing for free delivery and no prefill for guests", async () => {
    const { loader } = await import("./checkout");
    const view = { lines: [line], itemCount: 2, subtotal: "900.00" };
    cart.getCartView.mockResolvedValueOnce(view);

    expect(await loader(get())).toEqual({
      cart: view,
      prefill: null,
      shipping: { free: false, remaining: "100.00" },
    });
    expect(orders.getCheckoutPrefill).not.toHaveBeenCalled();
  });

  it("prefills a logged-in user's contact details", async () => {
    const { loader } = await import("./checkout");
    const prefill = { fullName: "Olena", email: "olena@example.com", phone: null };
    cart.getCartOwner.mockResolvedValueOnce({ userId: 7 });
    cart.getCartView.mockResolvedValueOnce({ lines: [line], itemCount: 2, subtotal: "1000.00" });
    orders.getCheckoutPrefill.mockResolvedValueOnce(prefill);

    expect(await loader(get())).toMatchObject({ prefill, shipping: { free: true } });
    expect(orders.getCheckoutPrefill).toHaveBeenCalledWith(7);
  });
});

describe("checkout action", () => {
  it("returns field errors and the submitted values without placing an order", async () => {
    const { action } = await import("./checkout");
    const fields = { ...valid, phone: "12345", city: " " };

    expect(unwrap(await action(post(fields)))).toEqual({
      status: 400,
      body: {
        fieldErrors: {
          phone: "checkout.errors.phoneInvalid",
          city: "checkout.errors.cityRequired",
        },
        values: fields,
      },
    });
    expect(orders.createOrder).not.toHaveBeenCalled();
  });

  it("places the order with the normalised details and redirects to its success page", async () => {
    const { action } = await import("./checkout");
    orders.createOrder.mockResolvedValueOnce({ ok: true, orderId: 42 });

    const response = await action(post(valid));

    expect(response).toBeInstanceOf(Response);
    const redirect = response as Response;
    expect(redirect.headers.get("Location")).toBe("/checkout/success/42");
    expect(redirect.headers.get("Set-Cookie")).toContain("__jassmin_session=abc");
    expect(orders.createOrder).toHaveBeenCalledWith({
      cartId: 5,
      userId: null,
      customer: { ...valid, phone: "+380671234567" },
    });
    expect(session.rememberOrder).toHaveBeenCalledWith(expect.any(Request), 42);
  });

  it("links a registered user's order to them", async () => {
    const { action } = await import("./checkout");
    cart.getCartOwner.mockResolvedValueOnce({ userId: 7 });
    orders.createOrder.mockResolvedValueOnce({ ok: true, orderId: 43 });

    await action(post(valid));

    expect(orders.createOrder).toHaveBeenCalledWith(expect.objectContaining({ userId: 7 }));
  });

  it("explains when stock ran out while checking out", async () => {
    const { action } = await import("./checkout");
    orders.createOrder.mockResolvedValueOnce({
      ok: false,
      error: "insufficient-stock",
      lines: [{ variantId: line.variantId, available: 1 }],
    });

    expect(unwrap(await action(post(valid)))).toEqual({
      status: 409,
      body: { formError: "checkout.errors.stockChanged", values: valid },
    });
    expect(session.rememberOrder).not.toHaveBeenCalled();
  });

  it("sends the visitor to the cart without an active or non-empty cart", async () => {
    const { action } = await import("./checkout");

    cart.getActiveCartId.mockResolvedValueOnce(undefined);
    expect(await redirectOf(action(post(valid)))).toBe("/cart");
    expect(orders.createOrder).not.toHaveBeenCalled();

    orders.createOrder.mockResolvedValueOnce({ ok: false, error: "cart-empty" });
    expect(await redirectOf(action(post(valid)))).toBe("/cart");
  });
});
