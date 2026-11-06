import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import type { AccountOrder, AccountOrderLine } from "~/lib/account";
import type { OrderStatus } from "~/lib/enums";
import type { GiftCardView } from "~/lib/gift-cards";
import { createTranslator, I18nProvider, type Locale } from "~/lib/i18n";
import { AccountGiftCards } from "./AccountGiftCards";
import { CurrentOrderCard } from "./CurrentOrderCard";
import { OrderLineThumb } from "./OrderLineItem";
import { OrderProgress } from "./OrderProgress";
import { OrderStatusPill } from "./OrderStatusPill";
import { PreviousOrdersList } from "./PreviousOrdersList";
import { RESEND_VERIFICATION_INTENT, VerifyEmailBanner } from "./VerifyEmailBanner";

// Links need a router.
const render = (element: ReactElement, locale: Locale = "uk") =>
  renderToStaticMarkup(
    createElement(
      I18nProvider,
      { locale },
      createElement(RouterProvider, {
        router: createMemoryRouter([{ path: "/en/account", element }], {
          initialEntries: ["/en/account"],
        }),
      }),
    ),
  );

const order = (status: OrderStatus, overrides: Partial<AccountOrder> = {}): AccountOrder => ({
  id: 42,
  status,
  createdAt: new Date("2026-10-21T10:00:00Z"),
  paidAt: null,
  cancelledAt: null,
  refundedAt: null,
  shippedAt: null,
  completedAt: null,
  totalAmount: "2430.00",
  itemCount: 3,
  lines: [
    {
      key: "1",
      title: "Coco Mademoiselle",
      brand: "Chanel",
      imageUrl: "https://example.com/coco.jpg",
      productId: "01a1652b-6e25-7c03-ae47-25b57131fb06",
      fragranceFamily: "квіткові",
      volumeMl: 5,
      packSize: 1,
      quantity: 2,
      unitPrice: "990.00",
      lineTotal: "1980.00",
    },
    {
      key: "2",
      title: null,
      brand: null,
      imageUrl: null,
      productId: null,
      fragranceFamily: null,
      volumeMl: 10,
      packSize: 1,
      quantity: 1,
      unitPrice: "450.00",
      lineTotal: "450.00",
    },
  ],
  ...overrides,
});

/** The `<li>` steps of the progress indicator, in order. */
const steps = (html: string) => html.match(/<li[^>]*>.*?<\/li>/g) ?? [];

describe("OrderProgress", () => {
  it("marks earlier steps done and the status as the current step", () => {
    const html = render(createElement(OrderProgress, { status: "paid" }), "en");
    const items = steps(html);

    expect(items).toHaveLength(4);
    expect(items[0]).toContain("Placed");
    expect(items[0]).toContain("(done)");
    expect(items[1]).toContain('aria-current="step"');
    expect(items[1]).toContain("(current)");
    expect(items[2]).not.toContain("(done)");
    expect(items[3]).toContain("Delivered");
  });

  it("starts at the first step for a pending order and reaches shipped", () => {
    expect(steps(render(createElement(OrderProgress, { status: "pending" })))[0]).toContain(
      'aria-current="step"',
    );
    const shipped = steps(render(createElement(OrderProgress, { status: "shipped" })));
    expect(shipped[2]).toContain('aria-current="step"');
    expect(shipped.slice(0, 2).every((item) => item.includes("(виконано)"))).toBe(true);
  });

  it("shows the date of steps that have one", () => {
    const html = render(
      createElement(OrderProgress, {
        status: "paid",
        dates: { paid: new Date("2026-10-22T09:00:00Z") },
      }),
      "en",
    );
    expect(steps(html)[1]).toContain("22 October 2026");
  });

  it("renders nothing for statuses off the path", () => {
    expect(render(createElement(OrderProgress, { status: "cancelled" }))).toBe("");
  });
});

describe("OrderLineThumb (#99, #122)", () => {
  const [bought, deleted] = order("paid").lines as [AccountOrderLine, AccountOrderLine];

  it("shows the product's photo", () => {
    const html = render(createElement(OrderLineThumb, { line: bought }));
    expect(html).toContain('src="https://example.com/coco.jpg"');
    expect(html).not.toContain("<svg");
  });

  it("shows the shop's bottle photo when the product has no photo", () => {
    const html = render(createElement(OrderLineThumb, { line: { ...bought, imageUrl: null } }));
    expect(html).toMatch(/src="[^"]*shop-bottle-640[^"]*\.webp"/);
    expect(html).toMatch(/srcSet="[^"]*shop-bottle-320[^"]*\.webp 320w/);
    expect(html).toContain('sizes="52px"');
    expect(html).toContain('alt=""');
    expect(html).not.toContain("<svg");
  });

  it("is a neutral tile once the product has been deleted", () => {
    const html = render(createElement(OrderLineThumb, { line: deleted }));
    expect(html).toContain("bg-card");
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("<img");
  });
});

describe("OrderStatusPill", () => {
  it("names every status in Ukrainian and English", () => {
    expect(render(createElement(OrderStatusPill, { status: "shipped" }))).toContain("Відправлено");
    expect(render(createElement(OrderStatusPill, { status: "unclaimed" }), "en")).toContain(
      "Not collected",
    );
  });

  it("uses theme tokens: pink for current, green for delivered, neutral otherwise", () => {
    expect(render(createElement(OrderStatusPill, { status: "pending" }))).toContain("bg-primary");
    expect(render(createElement(OrderStatusPill, { status: "completed" }))).toContain(
      "bg-success-bg",
    );
    expect(render(createElement(OrderStatusPill, { status: "returned" }))).toContain("bg-card");
  });
});

describe("CurrentOrderCard", () => {
  it("shows the number, date, item count, total and a link to the details", () => {
    const html = render(createElement(CurrentOrderCard, { order: order("shipped") }), "en");
    const { formatPrice } = createTranslator("en");

    expect(html).toContain("Order #42");
    expect(html).toContain("Placed 21 October 2026");
    expect(html).toContain("3 items");
    expect(html).toContain(formatPrice("2430.00"));
    expect(html).toContain('href="/en/account/orders/42"');
    expect(html).toContain('src="https://example.com/coco.jpg"');
  });

  it("dates the shipped step once the order was shipped (#40)", () => {
    const html = render(
      createElement(CurrentOrderCard, {
        order: order("shipped", { shippedAt: new Date("2026-10-23T12:00:00Z") }),
      }),
      "en",
    );

    expect(steps(html)[2]).toContain("23 October 2026");
  });

  it("uses Ukrainian plurals for the item count", () => {
    const html = render(createElement(CurrentOrderCard, { order: order("pending") }));
    expect(html).toContain("3 товари");
    expect(html).toContain("Замовлення №42");
  });
});

describe("PreviousOrdersList", () => {
  it("lists orders as expandable rows with the price at purchase", () => {
    const { formatPrice } = createTranslator("uk");
    const html = render(
      createElement(PreviousOrdersList, {
        orders: [order("completed"), order("cancelled", { id: 7 })],
      }),
    );

    expect(html.match(/<details/g)).toHaveLength(2);
    expect(html).toContain("Отримано");
    expect(html).toContain("Скасовано");
    expect(html).toContain(formatPrice("990.00"));
    expect(html).toContain("Chanel · 5 мл · 2 шт.");
    expect(html).toContain("Цей парфум більше не продається");
    expect(html).toContain('href="/kabinet/zamovlennia/7"');
  });
});

describe("AccountGiftCards (#125)", () => {
  const card: GiftCardView = {
    id: 12,
    status: "active",
    initialAmount: "1000.00",
    balance: "400.00",
    code: "ABCD2345EFGH6789",
    buyerEmail: "me@example.com",
    recipientEmail: "friend@example.com",
    createdAt: new Date("2026-11-05T10:00:00Z"),
    expiresAt: new Date("2027-11-05T10:00:00Z"),
  };
  const pending: GiftCardView = {
    ...card,
    id: 13,
    status: "pending",
    balance: "500.00",
    initialAmount: "500.00",
    code: null,
    recipientEmail: null,
    expiresAt: null,
  };
  const normalize = (html: string) => html.replace(/[  ]/g, " ");

  it("shows each card's amount, code, balance, expiry and recipient", () => {
    const html = normalize(render(createElement(AccountGiftCards, { cards: [card, pending] })));
    expect(html).toContain("Подарункові картки");
    expect(html).toContain("Картка на 1 000 ₴");
    expect(html).toContain("ABCD-2345-EFGH-6789");
    expect(html).toContain("Залишок: 400 ₴");
    expect(html).toContain("Діє до 5 листопада 2027 р.");
    expect(html).toContain("Для friend@example.com");
    expect(html).toContain("Активна");
  });

  it("links an unpaid card to its page to pay, without a code or balance", () => {
    const html = normalize(render(createElement(AccountGiftCards, { cards: [pending] }), "en"));
    expect(html).toContain("₴500 card");
    expect(html).toContain("Awaiting payment");
    expect(html).toContain('href="/en/gift-cards/success/13"');
    expect(html).toContain("Pay for the card");
    expect(html).not.toContain("Balance:");
    expect(html).toContain('href="/en/gift-cards"');
  });
});

describe("VerifyEmailBanner (#135)", () => {
  const props = { email: "o@e.com", resent: false, submitting: false };

  it("asks to confirm the email, with a resend button", () => {
    const html = render(createElement(VerifyEmailBanner, props));
    expect(html).toContain("Підтвердіть свій email");
    expect(html).toContain("o@e.com");
    expect(html).toContain(`name="intent" value="${RESEND_VERIFICATION_INTENT}"`);
    expect(html).toMatch(/<form[^>]*method="post"/);
    expect(render(createElement(VerifyEmailBanner, props), "en")).toContain("Send it again");
  });

  it("confirms a resend and shows errors", () => {
    expect(render(createElement(VerifyEmailBanner, { ...props, resent: true }), "en")).toContain(
      "We sent a new link to o@e.com.",
    );
    const html = render(
      createElement(VerifyEmailBanner, { ...props, error: "auth.errors.tooManyRequests" }),
    );
    expect(html).toContain('role="alert"');
  });
});
