import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
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

const renderLayout = (path = "/admin/products") =>
  renderToStaticMarkup(createElement(Stub, { initialEntries: [path] }));

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

    expect(ADMIN_NAV_ITEMS.map((item) => item.label)).toEqual(["Products", "Orders"]);
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
});
