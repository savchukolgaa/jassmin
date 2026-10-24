import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { createTranslator, I18nProvider, type Locale } from "~/lib/i18n";
import { Footer } from "./Footer";
import { FOOTER_LINKS } from "./nav";

// The "Cookie settings" `<Form>` needs a data router. Without a locale, the default (Ukrainian).
function renderFooter(locale: Locale | null = "en", path = "/") {
  const router = createMemoryRouter([{ path: "*", element: createElement(Footer) }], {
    initialEntries: [path],
  });
  const app = createElement(RouterProvider, { router });
  return renderToStaticMarkup(locale ? createElement(I18nProvider, { locale }, app) : app);
}

describe("Footer", () => {
  it("renders a deep-pink footer that clips its content", () => {
    expect(renderFooter()).toMatch(
      /^<footer class="[^"]*overflow-hidden[^"]*bg-primary text-white"/,
    );
  });

  it("links to both catalogs, the blog, about us, contacts and the privacy policy in order", () => {
    const html = renderFooter();
    const positions = FOOTER_LINKS.map((link) => html.indexOf(`href="${link.to}"`));

    const { t } = createTranslator("en");
    expect(FOOTER_LINKS.map((link) => t(link.labelKey))).toEqual([
      "Women",
      "Men",
      "Blog",
      "About us",
      "Contacts",
      "Privacy policy",
    ]);
    expect(FOOTER_LINKS.at(-1)?.to).toBe("/privacy");
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(html).toContain('<nav aria-label="Footer">');
  });

  it("renders the links in Ukrainian by default", () => {
    const html = renderFooter(null);

    for (const text of [">Жіночі<", ">Чоловічі<", ">Блог<", ">Про нас<", ">Контакти<"]) {
      expect(html).toContain(text);
    }
    expect(html).toContain('<nav aria-label="Нижнє меню">');
  });

  it("shows the copyright with the current year", () => {
    expect(renderFooter()).toContain(`© <span>${new Date().getFullYear()}</span> Jassmin`);
  });

  it("has a Cookie settings button that shows the cookie banner again", () => {
    const html = renderFooter("en", "/blog?page=2");

    expect(html).toMatch(/<form(?=[^>]*method="post")(?=[^>]*action="\/consent")/);
    expect(html).toContain('<input type="hidden" name="redirectTo" value="/blog?page=2"/>');
    expect(html).toMatch(
      /<button(?=[^>]*type="submit")(?=[^>]*name="consent")(?=[^>]*value="reset")[^>]*>Cookie settings</,
    );
    expect(renderFooter(null)).toContain(">Налаштування cookie<");
  });

  it("hides the decorative wordmark from assistive technology", () => {
    expect(renderFooter()).toMatch(/<p aria-hidden="true"[^>]*>jassmin\.<\/p>/);
  });
});
