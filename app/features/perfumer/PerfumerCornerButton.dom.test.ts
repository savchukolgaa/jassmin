// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { createElement, Fragment } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddToCartForm } from "~/features/cart/AddToCartForm";
import type { CartActionResult } from "~/lib/cart";
import { I18nProvider, type Locale } from "~/lib/i18n";
import { PAGES, type Page } from "~/lib/paths";
import { CART_ADDED_RAISE_MS, PerfumerCornerButton } from "./PerfumerCornerButton";

// The floating corner link to the AI perfumer (#165): where it shows, its name, how it moves for
// the cookie banner and "Added to cart", and an axe check.

function renderCorner({
  url = "/",
  locale = "uk" as Locale,
  cookieBanner = false,
  withCart = false,
} = {}) {
  const page = createElement(
    Fragment,
    null,
    createElement(
      "main",
      null,
      createElement("h1", null, "Сторінка"),
      withCart && createElement(AddToCartForm, { productId: "p1", variantId: "v1", inStock: true }),
    ),
    createElement(PerfumerCornerButton, { cookieBanner }),
  );
  const router = createMemoryRouter(
    [
      { path: "/koshyk", action: (): CartActionResult => ({ ok: true, intent: "add" }) },
      { path: "*", element: page },
    ],
    { initialEntries: [url] },
  );
  return render(createElement(I18nProvider, { locale }, createElement(RouterProvider, { router })));
}

/** A page's Ukrainian and English URL, with any parameter filled in. */
function urlsOf(page: Page): string[] {
  const fill = (pattern: string) => pattern.replace(/:\w+/g, "42");
  return [`/${fill(PAGES[page].uk)}`, `/en/${fill(PAGES[page].en)}`];
}

const corner = () => screen.queryByRole("link", { name: /AI парфумера|AI perfumer/ });

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("PerfumerCornerButton", () => {
  it("links to the chat, named by its label even where only the icon shows", () => {
    renderCorner();
    const link = corner();
    // `from=corner`: how the chat was opened, for analytics (#166).
    expect(link?.getAttribute("href")).toBe("/parfumer?from=corner");
    expect(link?.textContent).toBe("Запитати AI парфумера");
    expect(link?.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("speaks English on English pages", () => {
    renderCorner({ url: "/en/catalog/women", locale: "en" });
    expect(screen.getByRole("link", { name: "Ask the AI perfumer" }).getAttribute("href")).toBe(
      "/en/perfumer?from=corner",
    );
  });

  it.each([
    "perfumer",
    "cart",
    "checkout",
    "checkoutSuccess",
    "checkoutPay",
    "giftCardSuccess",
  ] as const)("is hidden on the %s page", (page) => {
    for (const url of urlsOf(page)) {
      renderCorner({ url });
      expect(corner(), url).toBeNull();
      cleanup();
    }
  });

  it.each(["home", "catalog", "product", "offers", "account"] as const)(
    "shows on the %s page",
    (page) => {
      for (const url of urlsOf(page)) {
        renderCorner({ url });
        expect(corner(), url).not.toBeNull();
        cleanup();
      }
    },
  );

  it("reserves the cookie banner's room while it shows", () => {
    renderCorner({ cookieBanner: true });
    expect(corner()?.hasAttribute("data-cookie-banner")).toBe(true);
    cleanup();
    renderCorner();
    expect(corner()?.hasAttribute("data-cookie-banner")).toBe(false);
  });

  it("hides with CSS while the mobile menu is open", () => {
    renderCorner();
    expect(corner()?.className).toContain(
      "max-lg:[body:has(details[data-mobile-menu][open])_&]:hidden",
    );
  });

  it("rises for a moment after a product is added to the cart", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderCorner({ withCart: true });
    expect(corner()?.hasAttribute("data-raised")).toBe(false);

    await user.click(screen.getByRole("button", { name: "Додати в кошик" }));

    await waitFor(() => expect(corner()?.hasAttribute("data-raised")).toBe(true));
    await act(async () => vi.advanceTimersByTime(CART_ADDED_RAISE_MS));
    expect(corner()?.hasAttribute("data-raised")).toBe(false);
  });

  it("has no axe violations", async () => {
    const { container } = renderCorner();
    // jsdom has no layout, so colour contrast can't be measured.
    const options: axe.RunOptions = { rules: { "color-contrast": { enabled: false } } };
    expect((await axe.run(container, options)).violations).toEqual([]);
  });
});
