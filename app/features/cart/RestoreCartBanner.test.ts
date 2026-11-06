import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { I18nProvider, type Locale } from "~/lib/i18n";
import { RestoreCartBanner } from "./RestoreCartBanner";

function render(locale: Locale, itemCount: number) {
  const element = createElement(RestoreCartBanner, {
    cartId: 9,
    abandonedAt: "2026-11-01T10:00:00.000Z",
    itemCount,
  });
  return renderToStaticMarkup(
    createElement(
      I18nProvider,
      { locale },
      createElement(RouterProvider, {
        router: createMemoryRouter([{ path: "*", element }], { initialEntries: ["/koshyk"] }),
      }),
    ),
  );
}

describe("RestoreCartBanner", () => {
  it("offers the saved cart with its date and size, posting the restore intent", () => {
    const html = render("uk", 3);
    expect(html).toContain("Ваш кошик від 1 листопада 2026");
    expect(html).toContain("У ньому 3 парфуми, які ще можна замовити.");
    const form = /<form[^>]*>/.exec(html)?.[0] ?? "";
    expect(form).toContain('method="post"');
    expect(form).toContain('action="/koshyk"');
    expect(html).toContain('name="intent" value="restore"');
    expect(html).toContain('name="cartId" value="9"');
    expect(html).toContain("Повернути в кошик");
  });

  it("is in English on English pages", () => {
    const html = render("en", 1);
    expect(html).toContain("Your cart from");
    expect(html).toContain("It has 1 perfume you can still order.");
    expect(html).toContain("Put them back in my cart");
  });
});
