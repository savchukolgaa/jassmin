import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import { createTranslator, I18nProvider } from "~/lib/i18n";
import { AdminLayout } from "./AdminLayout";
import { ADMIN_NAV_ITEMS, strapiAdminUrl } from "./admin-nav";

function TestAdmin() {
  return createElement(
    AdminLayout,
    { adminName: "Olha", strapiAdminUrl: "http://localhost:1337/admin" },
    createElement("p", null, "Page body"),
  );
}

// A data router, because the layout's logout `<Form>` needs one.
const Stub = createRoutesStub([{ path: "/admin/*", Component: TestAdmin }]);

// In English, like the assertions.
const renderLayout = (path = "/admin/products") =>
  renderToStaticMarkup(
    createElement(I18nProvider, { locale: "en" }, createElement(Stub, { initialEntries: [path] })),
  );

describe("strapiAdminUrl", () => {
  it("points at /admin on the Strapi URL", () => {
    expect(strapiAdminUrl("http://localhost:1337")).toBe("http://localhost:1337/admin");
    expect(strapiAdminUrl("http://localhost:1337/")).toBe("http://localhost:1337/admin");
  });

  it("keeps a path prefix", () => {
    expect(strapiAdminUrl("https://example.com/cms")).toBe("https://example.com/cms/admin");
  });
});

describe("AdminLayout", () => {
  it("links Products and Orders, in that order", () => {
    const html = renderLayout();
    const positions = ADMIN_NAV_ITEMS.map((item) => html.indexOf(`href="${item.to}"`));

    const { t } = createTranslator("en");
    expect(ADMIN_NAV_ITEMS.map((item) => t(item.labelKey))).toEqual(["Products", "Orders"]);
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("marks the current section", () => {
    expect(renderLayout("/admin/orders")).toMatch(
      /<a(?=[^>]*aria-current="page")(?=[^>]*href="\/admin\/orders")[^>]*>Orders<\/a>/,
    );
  });

  it("opens the Strapi admin in a new tab", () => {
    expect(renderLayout()).toMatch(
      /<a(?=[^>]*href="http:\/\/localhost:1337\/admin")(?=[^>]*target="_blank")(?=[^>]*rel="noopener noreferrer")[^>]*>Content \(Strapi\)/,
    );
  });

  it("shows the admin's name, a logout form and the page body", () => {
    const html = renderLayout();

    expect(html).toContain("Olha");
    expect(html).toMatch(/<form(?=[^>]*method="post")(?=[^>]*action="\/logout")/);
    expect(html).toContain("<main");
    expect(html).toContain("Page body");
  });

  it("has the language switcher and renders in Ukrainian by default", () => {
    const html = renderToStaticMarkup(createElement(Stub, { initialEntries: ["/admin/orders"] }));

    expect(html).toMatch(/<form(?=[^>]*method="post")(?=[^>]*action="\/locale")/);
    expect(html).toMatch(/aria-current="page"[^>]*>Замовлення<\/a>/);
    expect(html).toContain("До магазину");
  });
});
