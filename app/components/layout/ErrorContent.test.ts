import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { createTranslator, I18nProvider, type Locale } from "~/lib/i18n";
import { describeRouteError } from "~/lib/route-error";
import { ErrorContent } from "./ErrorContent";

// The 404 page (#88): one h1 that says what happened, and links to the rest of the shop in the
// page's language (#84).

const notFound = { status: 404, statusText: "", internal: false, data: null };

function render(error: unknown, locale: Locale) {
  const { t } = createTranslator(locale);
  const element = createElement(ErrorContent, describeRouteError(error, t, false));
  const router = createMemoryRouter([{ path: "*", element }], { initialEntries: ["/nope"] });
  return renderToStaticMarkup(
    createElement(I18nProvider, { locale }, createElement(RouterProvider, { router })),
  );
}

describe("ErrorContent", () => {
  it("gives a 404 one h1 and links to both catalogs, the bestsellers and the blog", () => {
    const html = render(notFound, "en");

    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toMatch(/<h1[^>]*>The requested page could not be found.<\/h1>/);
    expect(html).toContain('aria-label="Where to go next"');
    for (const href of ["/en/catalog/women", "/en/catalog/men", "/en/popular", "/en/blog"]) {
      expect(html).toContain(`href="${href}"`);
    }
  });

  it("links to the Ukrainian pages on a Ukrainian 404", () => {
    const html = render(notFound, "uk");

    expect(html).toContain("Сторінку не знайдено.");
    expect(html).toContain('href="/katalog/zhinochi"');
  });

  it("offers no links for other errors", () => {
    expect(render(new Error("boom"), "en")).not.toContain("<nav");
  });
});
