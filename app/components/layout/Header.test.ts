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
      /<a(?=[^>]*href="\/en")(?=[^>]*aria-label="Jassmin, home")[^>]*>jassmin<span aria-hidden="true" class="text-primary">\.<\/span><\/a>/,
    );
  });

  it("sets the wordmark in the serif (#73)", () => {
    expect(renderHeader()).toMatch(
      /<a(?=[^>]*aria-label="Jassmin, home")[^>]*class="[^"]*font-serif text-2xl font-bold tracking-\[-0\.01em\]/,
    );
  });

  it("renders a sticky white bar with dark text and a bottom border (#72)", () => {
    expect(renderHeader()).toMatch(
      /^<header class="sticky top-0[^"]*border-line border-b bg-white text-ink"/,
    );
  });

  it("styles the white bar with tokens only, so a palette change recolours it (#73)", () => {
    const html = renderHeader({ user: { id: 1 }, cartCount: 2 }, "/en/offers");

    // The flags' fills are the flags' own colours, so only class names are checked.
    const classes = [...html.matchAll(/class="([^"]*)"/g)].map(([, value = ""]) => value).join(" ");
    expect(classes).not.toMatch(/(?:bg|text|border|outline|ring|decoration)-\[/);
    expect(classes).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it("renders the nav items in the specified order", () => {
    const html = renderHeader();
    const positions = [
      ">About us<",
      ">Catalog<",
      ">Bestsellers<",
      ">Offers<",
      ">Contacts<",
      'aria-label="Log in"',
      'aria-label="Cart, 0 items"',
    ].map((marker) => html.indexOf(marker));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("links to the home page sections, both catalogs and the cart", () => {
    const html = renderHeader();

    for (const href of [
      "/en#about",
      "/en/catalog/men",
      "/en/catalog/women",
      "/en/popular",
      "/en/offers",
      "/en#contacts",
      "/en/cart",
    ]) {
      expect(html).toContain(`href="${href}"`);
    }
    expect(html).toContain(">Men Perfumes<");
    expect(html).toContain(">Women Perfumes<");
  });

  it("highlights Offers on the offers page", () => {
    expect(renderHeader({}, "/en/offers")).toMatch(
      /<a[^>]*class="[^"]*text-primary-dark[^"]*underline decoration-2[^"]*"[^>]*href="\/en\/offers"[^>]*>Offers<\/a>/,
    );
    expect(renderHeader()).not.toMatch(/class="[^"]*underline decoration-2[^"]*"[^>]*>Offers</);
  });

  it("highlights Bestsellers on the popular page, filtered or paged, in the bar and the menu", () => {
    for (const path of [
      "/en/popular",
      "/en/popular?family=%D1%81%D0%B2%D1%96%D0%B6%D1%96&page=2",
    ]) {
      const links = renderHeader({}, path).match(
        /<a[^>]*href="\/en\/popular"[^>]*>Bestsellers<\/a>/g,
      );
      expect(links).toHaveLength(2);
      for (const link of links ?? []) {
        expect(link).toContain('aria-current="page"');
      }
      expect(links?.[0]).toContain("underline decoration-2");
      expect(links?.[0]).toContain("text-primary-dark");
      // The mobile menu panel marks it by colour and weight, without the bar's underline.
      expect(links?.[1]).toContain("text-primary-dark");
      expect(links?.[1]).not.toContain("underline");
    }
    expect(renderHeader()).not.toMatch(/aria-current="page"[^>]*>Bestsellers</);
  });

  it("labels Bestsellers in Ukrainian", () => {
    expect(renderHeader({}, "/", "uk")).toContain(">Бестселери<");
  });

  it("renders the catalog dropdown as a collapsed <details> disclosure", () => {
    expect(renderHeader()).toMatch(/<details[^>]*><summary[^>]*aria-expanded="false"[^>]*>Catalog/);
  });

  it("highlights the catalog trigger on catalog pages", () => {
    expect(renderHeader({}, "/en/catalog/women")).toMatch(
      /<summary[^>]*class="[^"]*underline decoration-2[^"]*"[^>]*>Catalog/,
    );
  });

  it("links the profile icon to login when logged out", () => {
    const html = renderHeader();

    expect(html).toMatch(
      /<a[^>]*aria-label="Log in"[^>]*href="\/en\/login"|href="\/en\/login"[^>]*aria-label="Log in"/,
    );
    expect(html).not.toContain('href="/en/account"');
  });

  it("links the profile icon to the account when logged in", () => {
    const html = renderHeader({ user: { id: 1 } });

    expect(html).toContain('href="/en/account"');
    expect(html).toContain('aria-label="My account"');
    expect(html).not.toContain('href="/en/login"');
  });

  it("shows the logged-in profile as a deep-pink circle and logged out as a dark icon", () => {
    const profileClass = (html: string) =>
      html.match(/<a[^>]*aria-label="(?:My account|Log in)"[^>]*class="([^"]*)"/)?.[1] ?? "";

    expect(profileClass(renderHeader({ user: { id: 1 } }))).toContain(
      "rounded-full bg-primary text-white",
    );
    const loggedOut = profileClass(renderHeader());
    expect(loggedOut).toContain("text-ink");
    expect(loggedOut).not.toContain("bg-primary");
    expect(loggedOut).toContain("hover:bg-blush");
    expect(profileClass(renderHeader({}, "/en/login"))).toContain("bg-blush text-primary-dark");
  });

  it("renders the cart as a deep-pink pill with white text", () => {
    expect(renderHeader()).toMatch(
      /<a[^>]*aria-label="Cart, 0 items"[^>]*class="[^"]*rounded-pill[^"]*bg-primary[^"]*text-white[^"]*hover:bg-primary-dark/,
    );
  });

  it("uses the deep-pink focus ring of light surfaces on every header control", () => {
    const html = renderHeader({ user: { id: 1 } });

    expect(html).toMatch(
      /<a[^>]*aria-label="Cart, 0 items"[^>]*class="[^"]*focus-visible:outline-3[^"]*focus-visible:outline-primary/,
    );
    for (const control of html.match(/<(?:a|button|summary)\b[^>]*>/g) ?? []) {
      expect(control).toContain("focus-visible:outline-primary");
    }
    expect(html).not.toContain("focus-visible:outline-white");
  });

  it("puts the bar's language switcher and the menu button on the light style", () => {
    const html = renderHeader();

    expect(html).toMatch(/aria-pressed="true" class="[^"]*bg-blush text-primary-dark/);
    expect(html).toMatch(/<summary[^>]*aria-label="Menu"[^>]*class="[^"]*text-ink/);
    expect(html).not.toContain("text-white hover:bg-primary-dark");
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
    const html = renderHeader({}, "/en/catalog/men?sort=price_asc");
    const switchers = html.match(/<form[^>]*action="\/locale"/g) ?? [];

    // In the bar (from `md`) and in the mobile menu.
    expect(switchers).toHaveLength(2);
    expect(html).toMatch(/<form(?=[^>]*method="post")[^>]*action="\/locale"/);
    expect(html).toContain(
      '<input type="hidden" name="redirectTo" value="/en/catalog/men?sort=price_asc"/>',
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
  it("shows the store's social links in the mobile menu, after the language switcher (#101)", () => {
    const html = renderHeader({
      socialLinks: [
        { platform: "instagram", url: "https://www.instagram.com/jassminperfume" },
        { platform: "telegram", url: "https://t.me/jassmin" },
      ],
    });
    const menu = html.slice(html.indexOf("<details"));

    expect(menu).toContain('aria-label="Jassmin on Instagram"');
    expect(menu.indexOf('aria-label="Jassmin on Telegram"')).toBeGreaterThan(
      menu.indexOf('aria-label="Jassmin on Instagram"'),
    );
    expect(menu).toMatch(/<a(?=[^>]*aria-label="Jassmin on Instagram")[^>]*outline-primary /);
  });

  it("has no social row in the mobile menu without links", () => {
    expect(renderHeader()).not.toContain('aria-label="Social media"');
  });
});
