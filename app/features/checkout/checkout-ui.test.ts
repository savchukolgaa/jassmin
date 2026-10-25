import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import type { OrderSummaryLine } from "~/lib/checkout";
import { I18nProvider, type Locale } from "~/lib/i18n";
import { CheckoutForm, type CheckoutFormProps } from "./CheckoutForm";
import { OrderSummary } from "./OrderSummary";
import { PaymentStatus } from "./PaymentStatus";

// `<Form>` needs a data router.
const routerFor = (element: ReactElement) =>
  createMemoryRouter(
    [
      {
        path: "/checkout",
        element,
        // Never settles, so a submission stays in the `submitting` state.
        action: () => new Promise<never>(() => {}),
      },
    ],
    { initialEntries: ["/checkout"] },
  );

const render = (router: ReturnType<typeof routerFor>, locale: Locale = "en") =>
  renderToStaticMarkup(
    createElement(I18nProvider, { locale }, createElement(RouterProvider, { router })),
  );

const renderForm = (props: CheckoutFormProps, locale?: Locale) =>
  render(routerFor(createElement(CheckoutForm, props)), locale);

/** The whole `<input …/>` or `<button …>` tag that contains `needle`. */
const tag = (html: string, needle: string, element = "input") =>
  html.match(new RegExp(`<${element}[^>]*${needle}[^>]*>`))?.[0] ?? "";

const line: OrderSummaryLine = {
  key: "1",
  title: "Coco Mademoiselle",
  brand: "Chanel",
  volumeMl: 30,
  packSize: 1,
  quantity: 2,
  unitPrice: "450.00",
  lineTotal: "900.00",
};

describe("CheckoutForm", () => {
  it("renders the contact, delivery and payment sections with cash on delivery preselected", () => {
    const html = renderForm({ prefill: null });

    expect(html).toContain('method="post"');
    expect(html).toContain("<legend");
    for (const text of ["Contact details", "Nova Poshta delivery", "Payment", "Place order"]) {
      expect(html).toContain(text);
    }
    for (const name of ["fullName", "email", "phone", "city", "branch"]) {
      expect(html).toContain(`name="${name}"`);
    }
    expect(tag(html, 'value="cod"')).toContain('checked=""');
    expect(tag(html, 'value="card"')).not.toContain('checked=""');
  });

  it("posts the total it was shown with (#59)", () => {
    expect(renderForm({ prefill: null, expectedTotal: "499.00" })).toContain(
      '<input type="hidden" name="expectedTotal" value="499.00"/>',
    );
    expect(renderForm({ prefill: null })).not.toContain("expectedTotal");
  });

  it("prefills a logged-in user's details, and submitted values win", () => {
    const prefill = { fullName: "Olena Koval", email: "olena@example.com", phone: "+380671234567" };

    expect(renderForm({ prefill })).toContain('value="olena@example.com"');
    const html = renderForm({
      prefill,
      values: { email: "other@example.com", city: "Lviv", paymentMethod: "card" },
    });
    expect(html).toContain('value="other@example.com"');
    expect(html).toContain('value="Lviv"');
    expect(html).toContain('value="+380671234567"');
    expect(tag(html, 'value="card"')).toContain('checked=""');
  });

  it("shows translated field errors and marks the fields invalid", () => {
    const html = renderForm({
      prefill: null,
      fieldErrors: {
        phone: "checkout.errors.phoneInvalid",
        paymentMethod: "checkout.errors.paymentRequired",
      },
    });

    expect(html).toContain("Enter a Ukrainian number, e.g. +380 67 123 45 67");
    expect(html).toContain("Choose a payment method");
    expect(tag(html, 'name="phone"')).toContain('aria-invalid="true"');
    expect(tag(html, 'value="card"')).toContain('aria-invalid="true"');
  });

  it("disables card payment with a note when no provider is configured", () => {
    const html = renderForm({
      prefill: null,
      values: { paymentMethod: "card" },
      cardAvailable: false,
    });
    const cardRadio = tag(html, 'value="card"');

    expect(cardRadio).toContain("disabled");
    expect(cardRadio).not.toContain("checked");
    expect(html).toContain("Card payment isn&#x27;t available right now");
    expect(tag(html, 'value="cod"')).not.toContain("disabled");
  });

  it("is in Ukrainian by default", () => {
    expect(renderForm({ prefill: null }, "uk")).toContain("Підтвердити замовлення");
  });

  it("disables the submit button while the order is being placed", async () => {
    const router = routerFor(createElement(CheckoutForm, { prefill: null }));
    expect(tag(render(router), 'type="submit"', "button")).not.toContain(' disabled=""');

    const formData = new FormData();
    formData.set("fullName", "Olena");
    void router.navigate("/checkout", { formMethod: "post", formData });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(router.state.navigation.state).toBe("submitting");
    const button = tag(render(router), 'type="submit"', "button");
    expect(button).toContain(' disabled=""');
    expect(button).toContain('aria-busy="true"');
  });
});

describe("OrderSummary", () => {
  const renderSummary = (props: Parameters<typeof OrderSummary>[0]) =>
    render(routerFor(createElement(OrderSummary, props)));

  it("lists the lines and the total, with free delivery from 1000 UAH", () => {
    const html = renderSummary({
      lines: [line],
      subtotal: "1200.00",
      total: "1200.00",
      freeShipping: true,
    });

    expect(html).toContain("Coco Mademoiselle");
    expect(html).toContain("30 ml · Qty 2");
    expect(html).toContain("Free");
    expect(html).not.toContain("more for free delivery");
  });

  it("says the recipient pays Nova Poshta below 1000 UAH and how much is missing", () => {
    const html = renderSummary({
      lines: [line],
      subtotal: "900.00",
      total: "900.00",
      freeShipping: false,
      remainingForFreeShipping: "100.00",
    });

    expect(html).toContain("Nova Poshta rates, paid on delivery");
    expect(html).toMatch(/Add ₴100 more for free delivery\./);
  });

  it("shows the discount between the subtotal and delivery, in English and Ukrainian (#59)", () => {
    const props = {
      lines: [line],
      subtotal: "4450.00",
      discount: { amount: "445.00", code: "JASSMIN10", kind: "percent" as const },
      total: "4005.00",
      freeShipping: true,
    };
    const english = renderSummary(props);
    expect(english).toMatch(
      /Subtotal<\/dt><dd>₴4,450<\/dd>.*Discount \(promo code JASSMIN10\)<\/dt><dd[^>]*>−₴445<\/dd>.*Delivery/,
    );
    expect(english).toContain("₴4,005");

    const ukrainian = render(
      routerFor(
        createElement(OrderSummary, {
          ...props,
          discount: { amount: "1871.00", code: null, kind: "fixed_price_set" as const },
        }),
      ),
      "uk",
    ).replace(/\s/gu, " ");
    expect(ukrainian).toContain("Тестерне тріо 3 × 10 мл");
    expect(ukrainian).toContain("−1 871 ₴");
  });

  it("has no discount row without a discount", () => {
    const html = renderSummary({
      lines: [line],
      subtotal: "900.00",
      discount: null,
      total: "900.00",
      freeShipping: false,
    });
    expect(html).not.toContain("Discount");
  });

  it("names a line whose product has been deleted", () => {
    const html = renderSummary({
      lines: [{ ...line, title: null, brand: null, volumeMl: null, packSize: null }],
      subtotal: "900.00",
      total: "900.00",
      freeShipping: false,
    });

    expect(html).toContain("This perfume is no longer sold");
    expect(html).toContain("Qty 2");
  });
});

describe("PaymentStatus", () => {
  const renderStatus = (payment: "paid" | "pending" | "failed", locale?: Locale) =>
    render(routerFor(createElement(PaymentStatus, { orderId: 42, payment })), locale);

  it("says a paid order is paid, without a pay button", () => {
    const html = renderStatus("paid");
    expect(html).toContain("Paid. Thank you!");
    expect(html).not.toContain("/checkout/pay/42");
  });

  it("lets a pending order pay or refresh the page", () => {
    const html = renderStatus("pending");
    expect(html).toContain("waiting for the payment to be confirmed");
    expect(tag(html, 'action="/checkout/pay/42"', "form")).toContain('method="post"');
    expect(html).toContain("Pay now");
    expect(html).toContain('href="/checkout/success/42"');
  });

  it("offers a retry after a failed payment", () => {
    const html = renderStatus("failed");
    expect(html).toContain("didn&#x27;t go through");
    expect(tag(html, 'action="/checkout/pay/42"', "form")).toContain('method="post"');
    expect(html).toContain("Try again");
    expect(html).not.toContain("Refresh the page");
  });

  it("is in Ukrainian by default", () => {
    expect(renderStatus("failed", "uk")).toContain("Спробувати ще раз");
  });
});
