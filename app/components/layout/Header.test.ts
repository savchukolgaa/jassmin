import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { I18nProvider, type Locale } from "~/lib/i18n";
import { Header, type HeaderProps } from "./Header";

// English by default, so the assertions read like the UI copy they check. The language switcher's
// `<Form>` needs a data router.
const renderHeader = (props: Partial<HeaderProps> = {}, path = "/", locale: Locale = "en") => {
  const element = createElement(Header, { user: null, cartCount: 0, ...props });
  const router = createMemoryRouter([{ path: "*", element }], { initialEntries: [path] });
  return renderToStaticMarkup(
    createElement(I18nProvider, { locale }, createElement(RouterProvider, { router })),
  );
};

describe("Header", () => {
  it("links the jassmin. wordmark to the home page", () => {
    expect(renderHeader()).toMatch(
      /<a(?=[^>]*href="\/")(?=[^>]*aria-label="Jassmin, home")[^>]*>jassmin<span aria-hidden="true" class="text-primary-light">\.<\/span><\/a>/,
    );
  });

  it("renders a sticky deep-pink bar", () => {
    expect(renderHeader()).toMatch(/^<header class="sticky top-0[^"]*bg-primary text-white"/);
  });

  it("renders the nav items in the specified order", () => {
    const html = renderHeader();
    const positions = [
      ">About us<",
      ">Catalog<",
      ">Contacts<",
      'aria-label="Log in"',
      'aria-label="Cart, 0 items"',
    ].map((marker) => html.indexOf(marker));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("links to the home page sections, both catalogs and the cart", () => {
    const html = renderHeader();

    for (const href of ["/#about", "/catalog/men", "/catalog/women", "/#contacts", "/cart"]) {
      expect(html).toContain(`href="${href}"`);
    }
    expect(html).toContain(">Men Perfumes<");
    expect(html).toContain(">Women Perfumes<");
  });

  it("renders the catalog dropdown as a collapsed <details> disclosure", () => {
    expect(renderHeader()).toMatch(/<details[^>]*><summary[^>]*aria-expanded="false"[^>]*>Catalog/);
  });

  it("highlights the catalog trigger on catalog pages", () => {
    expect(renderHeader({}, "/catalog/women")).toMatch(
      /<summary[^>]*class="[^"]*underline decoration-2[^"]*"[^>]*>Catalog/,
    );
  });

  it("links the profile icon to login when logged out", () => {
    const html = renderHeader();

    expect(html).toMatch(
      /<a[^>]*aria-label="Log in"[^>]*href="\/login"|href="\/login"[^>]*aria-label="Log in"/,
    );
    expect(html).not.toContain('href="/account"');
  });

  it("links the profile icon to the account when logged in", () => {
    const html = renderHeader({ user: { id: 1 } });

    expect(html).toContain('href="/account"');
    expect(html).toContain('aria-label="My account"');
    expect(html).not.toContain('href="/login"');
  });

  it("shows the logged-in profile as a white circle and logged out as a white icon", () => {
    const profileClass = (html: string) =>
      html.match(/<a[^>]*aria-label="(?:My account|Log in)"[^>]*class="([^"]*)"/)?.[1] ?? "";

    expect(profileClass(renderHeader({ user: { id: 1 } }))).toContain(
      "rounded-full bg-white text-primary",
    );
    const loggedOut = profileClass(renderHeader());
    expect(loggedOut).toContain("text-white");
    expect(loggedOut).not.toContain("bg-white ");
    expect(loggedOut).toContain("hover:bg-primary-dark");
  });

  it("renders the cart as a white pill", () => {
    expect(renderHeader()).toMatch(
      /<a[^>]*aria-label="Cart, 0 items"[^>]*class="[^"]*rounded-pill[^"]*bg-white[^"]*text-primary/,
    );
  });

  it("uses a white focus ring on the pink bar", () => {
    expect(renderHeader()).toMatch(
      /<a[^>]*aria-label="Cart, 0 items"[^>]*class="[^"]*focus-visible:outline-3[^"]*focus-visible:outline-white/,
    );
  });

  it("shows no count for an empty cart", () => {
    expect(renderHeader()).not.toMatch(
      /aria-label="Cart, 0 items"[^>]*>.*<span aria-hidden="true">/,
    );
  });

  it("shows the cart count in a badge", () => {
    const html = renderHeader({ cartCount: 3 });

    expect(html).toContain('aria-label="Cart, 3 items"');
    expect(html).toMatch(/<span aria-hidden="true"[^>]*>3<\/span>/);
    expect(renderHeader({ cartCount: 1 })).toContain('aria-label="Cart, 1 item"');
    expect(renderHeader({ cartCount: 120 })).toMatch(/>99\+<\/span>/);
  });

  it("includes the hamburger menu for small screens", () => {
    expect(renderHeader()).toMatch(/<summary[^>]*aria-label="Menu"/);
  });

  it("renders in Ukrainian with Ukrainian plurals", () => {
    const html = renderHeader({ cartCount: 3 }, "/", "uk");

    for (const text of [">Про нас<", ">Каталог<", ">Контакти<", ">Жіночі парфуми<"]) {
      expect(html).toContain(text);
    }
    expect(html).toContain('aria-label="Кошик, 3 товари"');
    expect(renderHeader({ cartCount: 5 }, "/", "uk")).toContain('aria-label="Кошик, 5 товарів"');
    expect(html).toContain('aria-label="Увійти"');
    expect(html).not.toContain("Kontakt");
  });

  it("has a no-JS language switcher with flags that returns to the current page", () => {
    const html = renderHeader({}, "/catalog/men?sort=price_asc");
    const switchers = html.match(/<form[^>]*action="\/locale"/g) ?? [];

    // In the bar (from `md`) and in the mobile menu.
    expect(switchers).toHaveLength(2);
    expect(html).toMatch(/<form(?=[^>]*method="post")[^>]*action="\/locale"/);
    expect(html).toContain(
      '<input type="hidden" name="redirectTo" value="/catalog/men?sort=price_asc"/>',
    );
    expect(html).toMatch(
      /<button type="submit" value="en" lang="en" aria-pressed="true"[^>]*name="locale"><svg[^>]*aria-hidden="true"[^>]*>.*?<\/svg>EN<\/button>/,
    );
    expect(html).toMatch(
      /<button type="submit" value="uk" lang="uk" aria-pressed="false"[^>]*name="locale"><svg[^>]*aria-hidden="true"[^>]*>.*?<\/svg>УКР<\/button>/,
    );
    expect(html).toContain('<legend class="sr-only">Language</legend>');
  });

  it("marks Ukrainian as the active language when it is", () => {
    expect(renderHeader({}, "/", "uk")).toMatch(/value="uk" lang="uk" aria-pressed="true"/);
  });
});
