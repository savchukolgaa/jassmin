import { beforeEach, describe, expect, it, vi } from "vitest";
import { type CartLine, type CartView, EMPTY_CART } from "~/lib/cart";

const cart = vi.hoisted(() => ({
  getActiveCartId: vi.fn(),
  getCartOwner: vi.fn(),
  getCartView: vi.fn(),
}));
const orders = vi.hoisted(() => ({
  createOrder: vi.fn(),
  deliverOrderConfirmation: vi.fn(),
  getCheckoutPrefill: vi.fn(),
}));
const session = vi.hoisted(() => ({ rememberOrder: vi.fn() }));
const cmsSync = vi.hoisted(() => ({ pushToCms: vi.fn() }));
const analytics = vi.hoisted(() => ({ trackEvent: vi.fn() }));
const payments = vi.hoisted(() => ({
  isCardPaymentAvailable: vi.fn(),
  startPayment: vi.fn(),
}));

vi.mock("~/.server/services/cart", () => cart);
vi.mock("~/.server/services/orders", () => orders);
vi.mock("~/.server/session", () => session);
vi.mock("~/.server/services/cms-sync", () => cmsSync);
vi.mock("~/.server/analytics", () => analytics);
vi.mock("~/.server/services/payments", () => payments);

type ActionArgs = Parameters<typeof import("./checkout").action>[0];
type LoaderArgs = Parameters<typeof import("./checkout").loader>[0];

const guest = { userId: null, anonymousId: "0b6f1b8e-3f7e-4a52-9a43-3c1f7f1f2c11" };

const line: CartLine = {
  variantId: "01a1652b-6e25-7d00-8000-000000000050",
  productId: "01a1652b-6e25-7c03-ae47-25b57131fb06",
  slug: "coco-mademoiselle",
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

/** A cart view without a discount unless one is given. */
function cartView(view: Partial<CartView>): CartView {
  return { ...EMPTY_CART, total: view.subtotal ?? EMPTY_CART.total, ...view };
}

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

function post(
  fields: Record<string, string>,
  headers: HeadersInit = {},
  path = "/checkout",
): ActionArgs {
  const request = new Request(`http://localhost${path}`, {
    method: "POST",
    body: new URLSearchParams(fields),
    headers,
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
  payments.isCardPaymentAvailable.mockReturnValue(true);
});

describe("checkout loader", () => {
  it("sends the visitor back to the cart when it's empty or a line exceeds stock", async () => {
    const { loader } = await import("./checkout");

    cart.getCartView.mockResolvedValueOnce(cartView({ lines: [], itemCount: 0, subtotal: "0.00" }));
    expect(await redirectOf(loader(get()))).toBe("/cart");

    cart.getCartView.mockResolvedValueOnce(
      cartView({ lines: [{ ...line, quantity: 4 }], itemCount: 4, subtotal: "1800.00" }),
    );
    expect(await redirectOf(loader(get()))).toBe("/cart");
    expect(analytics.trackEvent).not.toHaveBeenCalled();
  });

  it("records checkout_start with the cart's subtotal and item count", async () => {
    const { loader } = await import("./checkout");
    cart.getCartView.mockResolvedValueOnce(
      cartView({ lines: [line], itemCount: 2, subtotal: "900.00" }),
    );
    const args = get();

    await loader(args);

    expect(analytics.trackEvent).toHaveBeenCalledTimes(1);
    expect(analytics.trackEvent).toHaveBeenCalledWith(
      { request: args.request, context: args.context },
      "checkout_start",
      {
        properties: {
          subtotal: "900.00",
          itemCount: 2,
          discountAmount: "0.00",
          discountCode: null,
        },
      },
    );
  });

  it("returns the cart, how much is missing for free delivery and no prefill for guests", async () => {
    const { loader } = await import("./checkout");
    const view = cartView({ lines: [line], itemCount: 2, subtotal: "900.00" });
    cart.getCartView.mockResolvedValueOnce(view);

    expect(await loader(get())).toEqual({
      cart: view,
      prefill: null,
      shipping: { free: false, remaining: "600.00" },
      cardPaymentAvailable: true,
    });
    expect(orders.getCheckoutPrefill).not.toHaveBeenCalled();
  });

  it("decides free delivery on the discounted total and records the applied code (#59)", async () => {
    const { loader } = await import("./checkout");
    const view = cartView({
      lines: [{ ...line, quantity: 3, lineTotal: "1350.00" }],
      itemCount: 3,
      subtotal: "1350.00",
      discount: { amount: "405.00", code: "SAVE30", kind: "percent" },
      total: "945.00",
      promo: { code: "SAVE30", status: "applied" },
    });
    cart.getCartView.mockResolvedValueOnce(view);

    expect(await loader(get())).toMatchObject({
      cart: view,
      shipping: { free: false, remaining: "555.00" },
    });
    expect(analytics.trackEvent).toHaveBeenCalledWith(expect.anything(), "checkout_start", {
      properties: {
        subtotal: "1350.00",
        itemCount: 3,
        discountAmount: "405.00",
        discountCode: "SAVE30",
      },
    });
  });

  it("says when card payment isn't available", async () => {
    const { loader } = await import("./checkout");
    cart.getCartView.mockResolvedValueOnce(
      cartView({ lines: [line], itemCount: 2, subtotal: "900.00" }),
    );
    payments.isCardPaymentAvailable.mockReturnValue(false);

    expect(await loader(get())).toMatchObject({ cardPaymentAvailable: false });
  });

  it("prefills a logged-in user's contact details", async () => {
    const { loader } = await import("./checkout");
    const prefill = { fullName: "Olena", email: "olena@example.com", phone: null };
    cart.getCartOwner.mockResolvedValueOnce({ userId: 7 });
    cart.getCartView.mockResolvedValueOnce(
      cartView({ lines: [line], itemCount: 2, subtotal: "1500.00" }),
    );
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
    expect(orders.deliverOrderConfirmation).not.toHaveBeenCalled();
    expect(analytics.trackEvent).not.toHaveBeenCalled();
  });

  it("places the order with the normalised details and redirects to its success page", async () => {
    const { action } = await import("./checkout");
    orders.createOrder.mockResolvedValueOnce({
      ok: true,
      orderId: 42,
      placed: true,
      subtotal: "900.00",
    });

    const response = await action(post(valid));

    expect(response).toBeInstanceOf(Response);
    const redirect = response as Response;
    expect(redirect.headers.get("Location")).toBe("/checkout/success/42");
    expect(redirect.headers.get("Set-Cookie")).toContain("__jassmin_session=abc");
    expect(orders.createOrder).toHaveBeenCalledWith({
      cartId: 5,
      userId: null,
      customer: { ...valid, phone: "+380671234567" },
      locale: "uk",
    });
    expect(session.rememberOrder).toHaveBeenCalledWith(expect.any(Request), 42);
    expect(orders.deliverOrderConfirmation).toHaveBeenCalledExactlyOnceWith(42);
    expect(cmsSync.pushToCms).toHaveBeenCalledOnce();
    // Cash on delivery never starts an online payment.
    expect(payments.startPayment).not.toHaveBeenCalled();
  });

  describe("card payment", () => {
    const card = { ...valid, paymentMethod: "card" };
    const placed = { ok: true, orderId: 42, placed: true, subtotal: "900.00" };
    const providerUrl = "http://localhost/payments/simulator?data=abc&signature=def";

    it("sends the shopper to the provider's page for the new order", async () => {
      const { action } = await import("./checkout");
      orders.createOrder.mockResolvedValueOnce(placed);
      payments.startPayment.mockResolvedValueOnce({
        ok: true,
        redirectUrl: providerUrl,
        reference: "42-1",
      });

      const response = (await action(post(card))) as Response;

      expect(response.headers.get("Location")).toBe(providerUrl);
      expect(response.headers.get("Set-Cookie")).toContain("__jassmin_session=abc");
      expect(payments.startPayment).toHaveBeenCalledWith({
        orderId: 42,
        locale: "uk",
        origin: "http://localhost",
      });
      expect(orders.deliverOrderConfirmation).toHaveBeenCalledExactlyOnceWith(42);
    });

    it("also starts a payment after a double submit", async () => {
      const { action } = await import("./checkout");
      orders.createOrder.mockResolvedValueOnce({ ok: true, orderId: 42, placed: false });
      payments.startPayment.mockResolvedValueOnce({
        ok: true,
        redirectUrl: providerUrl,
        reference: "42-2",
      });

      const response = (await action(post(card))) as Response;

      expect(response.headers.get("Location")).toBe(providerUrl);
      expect(orders.deliverOrderConfirmation).not.toHaveBeenCalled();
    });

    it("goes to the success page when the payment can't start", async () => {
      const { action } = await import("./checkout");
      const error = vi.spyOn(console, "error").mockImplementation(() => {});

      orders.createOrder.mockResolvedValueOnce(placed);
      payments.startPayment.mockResolvedValueOnce({ ok: false, error: "not-payable" });
      expect(((await action(post(card))) as Response).headers.get("Location")).toBe(
        "/checkout/success/42",
      );

      orders.createOrder.mockResolvedValueOnce(placed);
      payments.startPayment.mockRejectedValueOnce(new Error("db down"));
      expect(((await action(post(card))) as Response).headers.get("Location")).toBe(
        "/checkout/success/42",
      );
      expect(error).toHaveBeenCalled();
      error.mockRestore();
    });

    it("refuses card without a payment provider and places no order", async () => {
      const { action } = await import("./checkout");
      payments.isCardPaymentAvailable.mockReturnValue(false);

      expect(unwrap(await action(post(card)))).toEqual({
        status: 400,
        body: { fieldErrors: { paymentMethod: "checkout.errors.cardUnavailable" }, values: card },
      });
      expect(orders.createOrder).not.toHaveBeenCalled();
    });
  });

  it("queues the email in the shopper's language and doesn't wait for it to be sent", async () => {
    const { action } = await import("./checkout");
    orders.createOrder.mockResolvedValueOnce({
      ok: true,
      orderId: 42,
      placed: true,
      subtotal: "900.00",
    });
    // An SMTP server that never answers.
    orders.deliverOrderConfirmation.mockReturnValueOnce(new Promise(() => {}));

    const response = await action(post(valid, {}, "/en/checkout"));

    expect(orders.createOrder).toHaveBeenCalledWith(expect.objectContaining({ locale: "en" }));
    expect((response as Response).headers.get("Location")).toBe("/checkout/success/42");
  });

  it("records purchase for the placed order", async () => {
    const { action } = await import("./checkout");
    orders.createOrder.mockResolvedValueOnce({
      ok: true,
      orderId: 42,
      placed: true,
      subtotal: "900.00",
      discountAmount: "90.00",
      totalAmount: "810.00",
      discountId: 3,
      discountCode: "JASSMIN10",
      discountKind: "percent",
    });
    const args = post(valid);

    await action(args);

    expect(analytics.trackEvent).toHaveBeenCalledTimes(1);
    expect(analytics.trackEvent).toHaveBeenCalledWith(
      { request: args.request, context: args.context },
      "purchase",
      {
        properties: {
          orderId: 42,
          subtotal: "900.00",
          totalAmount: "810.00",
          discountAmount: "90.00",
          discountId: 3,
          discountCode: "JASSMIN10",
          paymentMethod: "cod",
        },
      },
    );
  });

  it("doesn't record purchase again for a double submit", async () => {
    const { action } = await import("./checkout");
    orders.createOrder.mockResolvedValueOnce({ ok: true, orderId: 42, placed: false });

    const response = await action(post(valid));

    expect((response as Response).headers.get("Location")).toBe("/checkout/success/42");
    expect(analytics.trackEvent).not.toHaveBeenCalled();
    // The first submit already tried to send its email.
    expect(orders.deliverOrderConfirmation).not.toHaveBeenCalled();
  });

  it("links a registered user's order to them", async () => {
    const { action } = await import("./checkout");
    cart.getCartOwner.mockResolvedValueOnce({ userId: 7 });
    orders.createOrder.mockResolvedValueOnce({
      ok: true,
      orderId: 43,
      placed: true,
      subtotal: "900.00",
    });

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
    expect(analytics.trackEvent).not.toHaveBeenCalled();
    expect(orders.deliverOrderConfirmation).not.toHaveBeenCalled();
  });

  it("passes the total the page showed and explains when it changed (#59)", async () => {
    const { action } = await import("./checkout");
    orders.createOrder.mockResolvedValueOnce({ ok: false, error: "total-changed" });
    const fields = { ...valid, expectedTotal: "810.00" };

    expect(unwrap(await action(post(fields)))).toEqual({
      status: 409,
      body: { formError: "checkout.errors.totalChanged", values: valid },
    });
    expect(orders.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedTotal: "810.00",
        customer: { ...valid, phone: "+380671234567" },
      }),
    );
    expect(analytics.trackEvent).not.toHaveBeenCalled();
  });

  it("ignores a malformed expected total", async () => {
    const { action } = await import("./checkout");
    orders.createOrder.mockResolvedValueOnce({ ok: true, orderId: 42, placed: false });

    await action(post({ ...valid, expectedTotal: "lots" }));

    expect(orders.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ expectedTotal: undefined }),
    );
  });

  it("sends the visitor to the cart without an active or non-empty cart", async () => {
    const { action } = await import("./checkout");

    cart.getActiveCartId.mockResolvedValueOnce(undefined);
    expect(await redirectOf(action(post(valid)))).toBe("/cart");
    expect(orders.createOrder).not.toHaveBeenCalled();

    orders.createOrder.mockResolvedValueOnce({ ok: false, error: "cart-empty" });
    expect(await redirectOf(action(post(valid)))).toBe("/cart");
    expect(orders.deliverOrderConfirmation).not.toHaveBeenCalled();
  });
});
