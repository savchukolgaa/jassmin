import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { createTranslator, I18nProvider, type Locale } from "~/lib/i18n";
import { Footer } from "./Footer";
import { FOOTER_LINKS } from "./nav";

const renderFooter = (locale: Locale = "en") =>
  renderToStaticMarkup(
    createElement(
      I18nProvider,
      { locale },
      createElement(MemoryRouter, null, createElement(Footer)),
    ),
  );

describe("Footer", () => {
  it("renders a deep-pink footer that clips its content", () => {
    expect(renderFooter()).toMatch(
      /^<footer class="[^"]*overflow-hidden[^"]*bg-primary text-white"/,
    );
  });

  it("links to both catalogs, the blog, about us and contacts in order", () => {
    const html = renderFooter();
    const positions = FOOTER_LINKS.map((link) => html.indexOf(`href="${link.to}"`));

    const { t } = createTranslator("en");
    expect(FOOTER_LINKS.map((link) => t(link.labelKey))).toEqual([
      "Women",
      "Men",
      "Blog",
      "About us",
      "Contacts",
    ]);
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(html).toContain('<nav aria-label="Footer">');
  });

  it("renders the links in Ukrainian by default", () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Footer)));

    for (const text of [">Жіночі<", ">Чоловічі<", ">Блог<", ">Про нас<", ">Контакти<"]) {
      expect(html).toContain(text);
    }
    expect(html).toContain('<nav aria-label="Нижнє меню">');
  });

  it("shows the copyright with the current year", () => {
    expect(renderFooter()).toContain(`© <span>${new Date().getFullYear()}</span> Jassmin`);
  });

  it("hides the decorative wordmark from assistive technology", () => {
    expect(renderFooter()).toMatch(/<p aria-hidden="true"[^>]*>jassmin\.<\/p>/);
  });
});
