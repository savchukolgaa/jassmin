import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "~/lib/i18n";
import { LanguageHint } from "./LanguageHint";

// On a Ukrainian page, so the surrounding UI is Ukrainian and the bar is still in English.
function renderHint(path = "/katalog/zhinochi?page=2") {
  const router = createMemoryRouter([{ path: "*", element: createElement(LanguageHint) }], {
    initialEntries: [path],
  });
  return renderToStaticMarkup(
    createElement(I18nProvider, { locale: "uk" }, createElement(RouterProvider, { router })),
  );
}

describe("LanguageHint", () => {
  it("offers the English version in English, posting to /locale with this page", () => {
    const html = renderHint();

    expect(html).toContain('action="/locale"');
    expect(html).toContain('lang="en"');
    expect(html).toContain('<section aria-label="Site language"');
    expect(html).toContain("This site is also available in English.");
    expect(html).toContain('name="redirectTo" value="/katalog/zhinochi?page=2"');
    expect(html).toMatch(/<button(?=[^>]*name="locale")(?=[^>]*value="en")[^>]*>View in English</);
  });

  it("can be dismissed, which keeps Ukrainian", () => {
    expect(renderHint()).toMatch(
      /<button(?=[^>]*name="locale")(?=[^>]*value="uk")(?=[^>]*aria-label="Stay in Ukrainian")/,
    );
  });
});
