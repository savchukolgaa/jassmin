import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { Header, type HeaderProps } from "./Header";

const renderHeader = (props: Partial<HeaderProps> = {}, path = "/") =>
  renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: [path] },
      createElement(Header, { user: null, cartCount: 0, ...props }),
    ),
  );

describe("Header", () => {
  it("links the brand to the home page", () => {
    expect(renderHeader()).toMatch(/<a[^>]*href="\/"[^>]*>Jassmin<\/a>/);
  });

  it("renders the nav items in the specified order", () => {
    const html = renderHeader();
    const positions = [
      ">About us<",
      ">Catalog<",
      ">Kontakt<",
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
      /<summary[^>]*class="[^"]*text-primary[^"]*"[^>]*>Catalog/,
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

  it("shows no badge for an empty cart", () => {
    expect(renderHeader()).not.toContain("bg-primary px-1");
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
});
