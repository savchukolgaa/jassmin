import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import type { GiftCardView } from "~/lib/gift-cards";
import { I18nProvider, type Locale } from "~/lib/i18n";
import { GiftCardPurchaseForm, type GiftCardPurchaseFormProps } from "./GiftCardPurchaseForm";
import { GiftCardStatus, type GiftCardStatusProps } from "./GiftCardStatus";

// `<Form>` needs a data router.
const render = (element: ReactElement, locale: Locale = "uk", path = "/podarunkovi-kartky") =>
  renderToStaticMarkup(
    createElement(
      I18nProvider,
      { locale },
      createElement(RouterProvider, {
        router: createMemoryRouter([{ path, element }], { initialEntries: [path] }),
      }),
    ),
  ).replace(/[  ]/g, " ");

const renderForm = (props: Partial<GiftCardPurchaseFormProps> = {}, locale?: Locale) =>
  render(
    createElement(GiftCardPurchaseForm, { prefillEmail: null, cardAvailable: true, ...props }),
    locale,
  );

/** The whole `<input …/>` or `<button …>` tag that contains `needle`. */
const tag = (html: string, needle: string, element = "input") =>
  html.match(new RegExp(`<${element}[^>]*${needle}[^>]*>`))?.[0] ?? "";

const card: GiftCardView = {
  id: 12,
  status: "active",
  initialAmount: "1000.00",
  balance: "1000.00",
  code: "ABCD2345EFGH6789",
  buyerEmail: "buyer@example.com",
  recipientEmail: null,
  createdAt: new Date("2026-11-05T10:00:00Z"),
  expiresAt: new Date("2027-11-05T10:00:00Z"),
};

const renderStatus = (props: GiftCardStatusProps, locale: Locale = "uk") =>
  render(
    createElement(GiftCardStatus, props),
    locale,
    locale === "en" ? "/en/gift-cards/success/12" : "/podarunkovi-kartky/uspikh/12",
  );

describe("GiftCardPurchaseForm", () => {
  it("offers the three amounts, 1000 UAH picked, the buyer's email and an optional recipient", () => {
    const html = renderForm();
    for (const amount of ["500", "1000", "2000"]) {
      expect(html).toContain(`value="${amount}"`);
    }
    expect(html).toContain("1 000 ₴");
    expect(html).toContain("2 000 ₴");
    expect(tag(html, 'value="1000"')).toContain('checked=""');
    expect(html).toContain('name="email"');
    expect(html).toContain('name="recipientEmail"');
    expect(html).toContain("Email отримувача (необов’язково)");
    expect(html).toContain("Оплатити 1 000 ₴");
    expect(tag(html, 'type="submit"', "button")).not.toContain('disabled=""');
  });

  it("is in English under /en", () => {
    const html = renderForm({}, "en");
    expect(html).toContain("Recipient&#x27;s email (optional)");
    expect(html).toContain("Pay ₴1,000");
  });

  it("prefills the buyer's email, and submitted values win", () => {
    expect(tag(renderForm({ prefillEmail: "me@example.com" }), 'name="email"')).toContain(
      'value="me@example.com"',
    );
    const html = renderForm({
      prefillEmail: "me@example.com",
      values: { amount: "500", email: "typed@example.com", recipientEmail: "friend@example.com" },
    });
    expect(tag(html, 'name="email"')).toContain('value="typed@example.com"');
    expect(tag(html, 'name="recipientEmail"')).toContain('value="friend@example.com"');
    expect(tag(html, 'value="500"')).toContain('checked=""');
  });

  it("shows translated errors", () => {
    const html = renderForm({
      fieldErrors: { amount: "giftCards.errors.amountRequired", email: "auth.errors.emailInvalid" },
    });
    expect(html).toContain("Оберіть номінал картки");
    expect(tag(html, 'name="email"')).toContain('aria-invalid="true"');
  });

  it("can't be sent without card payment", () => {
    const html = renderForm({ cardAvailable: false });
    expect(html).toContain("Оплата карткою зараз недоступна");
    expect(tag(html, 'type="submit"', "button")).toContain('disabled=""');
  });
});

describe("GiftCardStatus", () => {
  it("shows a paid card's code, balance and expiry", () => {
    const html = renderStatus({ card, payment: "paid" });
    expect(html).toContain("Картку оплачено!");
    expect(html).toContain("Код картки надіслано на buyer@example.com.");
    expect(html).toContain("ABCD-2345-EFGH-6789");
    expect(html).toContain("1 000 ₴");
    expect(html).toContain("Активна");
    expect(html).toContain("Діє до 5 листопада 2027 р.");
  });

  it("says the code also went to the recipient, in English", () => {
    const html = renderStatus(
      { card: { ...card, recipientEmail: "friend@example.com" }, payment: "paid" },
      "en",
    );
    expect(html).toContain(
      "The card&#x27;s code was sent to buyer@example.com and to friend@example.com.",
    );
  });

  it("offers to pay a pending card and to retry a failed one, without its code", () => {
    const pending = { ...card, status: "pending" as const, code: null, expiresAt: null };
    const waiting = renderStatus({ card: pending, payment: "pending" });
    expect(waiting).toContain("Очікуємо оплату картки");
    expect(waiting).toContain(">Оплатити<");
    expect(waiting).toContain('method="post"');
    expect(waiting).not.toContain("ABCD");

    const failed = renderStatus({ card: pending, payment: "failed" });
    expect(failed).toContain("Оплата не пройшла");
    expect(failed).toContain("Спробувати ще раз");
  });
});
