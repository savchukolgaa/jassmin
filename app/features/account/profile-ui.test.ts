import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import type { AccountProfile } from "~/lib/account";
import { I18nProvider, type Locale } from "~/lib/i18n";
import { ContactPanel, EmailPanel, MarketingPanel, PasswordPanel } from "./ProfileForms";

// `<Form>` needs a router.
const render = (element: ReactElement, locale: Locale = "uk") =>
  renderToStaticMarkup(
    createElement(
      I18nProvider,
      { locale },
      createElement(RouterProvider, {
        router: createMemoryRouter([{ path: "/account/profile", element }], {
          initialEntries: ["/account/profile"],
        }),
      }),
    ),
  );

const profile: AccountProfile = {
  fullName: "Олена Коваль",
  email: "olena@example.com",
  phone: "+380 67 123 45 67",
  createdAt: new Date("2026-01-15T10:00:00Z"),
  marketingOptIn: false,
};

describe("profile forms", () => {
  it("shows the marketing consent and confirms a subscribe or unsubscribe (#128)", () => {
    const off = render(createElement(MarketingPanel, { profile, submitting: false }));
    expect(off).toContain('<input type="hidden" name="intent" value="marketing"/>');
    expect(off).toContain('id="field-marketing-marketingOptIn"');
    expect(off).not.toContain('checked=""');
    expect(off).toContain("Розсилка");

    const on = { ...profile, marketingOptIn: true };
    const subscribed = render(
      createElement(MarketingPanel, { profile: on, result: { ok: true }, submitting: false }),
      "en",
    );
    expect(subscribed).toContain('checked=""');
    expect(subscribed).toContain("we&#x27;ll send you new arrivals");
    const unsubscribed = render(
      createElement(MarketingPanel, { profile, result: { ok: true }, submitting: false }),
      "en",
    );
    expect(unsubscribed).toContain("we won&#x27;t send you");
  });

  it("posts each form with its intent and prefills the contact details", () => {
    const html = render(
      createElement("div", null, [
        createElement(ContactPanel, { key: "c", profile, submitting: false }),
        createElement(EmailPanel, { key: "e", profile, submitting: false }),
        createElement(PasswordPanel, { key: "p", profile, submitting: false }),
      ]),
    );

    expect(html.match(/<form[^>]*method="post"/g)).toHaveLength(3);
    for (const intent of ["contact", "email", "password"]) {
      expect(html).toContain(`<input type="hidden" name="intent" value="${intent}"/>`);
    }
    expect(html).toContain('value="Олена Коваль"');
    expect(html).toContain('value="+380 67 123 45 67"');
    expect(html).toContain('id="field-email-currentPassword"');
    expect(html).toContain('id="field-password-currentPassword"');
  });

  it("renders Ukrainian by default and English when asked", () => {
    const uk = render(createElement(PasswordPanel, { profile, submitting: false }));
    const en = render(createElement(PasswordPanel, { profile, submitting: false }), "en");

    expect(uk).toContain("Повторіть новий пароль");
    expect(uk).toContain("Змінити пароль");
    expect(en).toContain("Confirm new password");
    expect(en).toContain("Change password");
  });

  it("shows field errors next to their inputs and keeps the typed values", () => {
    const html = render(
      createElement(ContactPanel, {
        profile,
        submitting: false,
        result: {
          ok: false,
          fieldErrors: { phone: "auth.errors.phoneInvalid" },
          values: { fullName: "Олена", phone: "call me" },
        },
      }),
      "en",
    );

    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="field-phone-error"');
    expect(html).toContain("Enter a valid phone number");
    expect(html).toContain('value="call me"');
  });

  it("shows the current-password error in the password form only", () => {
    const html = render(
      createElement("div", null, [
        createElement(EmailPanel, { key: "e", profile, submitting: false }),
        createElement(PasswordPanel, {
          key: "p",
          profile,
          submitting: false,
          result: {
            ok: false,
            fieldErrors: { currentPassword: "account.profile.errors.currentPasswordWrong" },
          },
        }),
      ]),
      "en",
    );

    expect(html).toContain('aria-describedby="field-password-currentPassword-error"');
    expect(html).not.toContain("field-email-currentPassword-error");
  });

  it("confirms a save in its own panel and never prefills a password", () => {
    const html = render(
      createElement("div", null, [
        createElement(ContactPanel, { key: "c", profile, submitting: false }),
        createElement(PasswordPanel, {
          key: "p",
          profile,
          submitting: false,
          result: { ok: true },
        }),
      ]),
      "en",
    );

    expect(html).toContain('role="status"');
    expect(html).toContain("Password changed.");
    expect(html).not.toContain("Contact details saved.");
    for (const input of html.match(/<input[^>]*type="password"[^>]*>/g) ?? []) {
      expect(input).not.toContain("value=");
    }
  });

  it("disables the submit of the form being sent", () => {
    const html = render(createElement(EmailPanel, { profile, submitting: true }), "en");

    expect(html).toContain("disabled");
    expect(html).toContain("Saving…");
  });
});
