import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { I18nProvider, type Locale } from "~/lib/i18n";
import { CookieBanner } from "./CookieBanner";

// The banner's `<Form>` needs a data router. Without a locale, the default (Ukrainian).
function renderBanner(locale: Locale | null = "en", path = "/catalog/women?sort=newest") {
  const router = createMemoryRouter([{ path: "*", element: createElement(CookieBanner) }], {
    initialEntries: [path],
  });
  const app = createElement(RouterProvider, { router });
  return renderToStaticMarkup(locale ? createElement(I18nProvider, { locale }, app) : app);
}

describe("CookieBanner", () => {
  it("posts the answer to /consent and comes back to the same page", () => {
    const html = renderBanner();

    expect(html).toMatch(/<form(?=[^>]*method="post")(?=[^>]*action="\/consent")/);
    expect(html).toContain(
      '<input type="hidden" name="redirectTo" value="/catalog/women?sort=newest"/>',
    );
    expect(html).toMatch(
      /<button(?=[^>]*type="submit")(?=[^>]*name="consent")(?=[^>]*value="granted")[^>]*>Accept</,
    );
    expect(html).toMatch(
      /<button(?=[^>]*type="submit")(?=[^>]*name="consent")(?=[^>]*value="denied")[^>]*>Decline</,
    );
  });

  it("is a labelled region that links to the privacy policy", () => {
    const html = renderBanner();
    const labelledBy = /<section aria-labelledby="([^"]+)"/.exec(html)?.[1];

    expect(labelledBy).toBeDefined();
    expect(html).toContain(
      `<h2 id="${labelledBy}" class="text-lg font-extrabold">We use cookies</h2>`,
    );
    expect(html).toMatch(/<a [^>]*href="\/privacy"[^>]*>Privacy policy<\/a>/);
  });

  it("speaks Ukrainian by default", () => {
    const html = renderBanner(null);

    for (const text of [">Ми використовуємо файли cookie<", ">Прийняти<", ">Відхилити<"]) {
      expect(html).toContain(text);
    }
  });
});
