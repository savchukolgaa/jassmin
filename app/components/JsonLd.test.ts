import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "~/lib/i18n";
import { breadcrumbListLd } from "~/lib/structured-data";
import { JsonLd } from "./JsonLd";
import { Breadcrumbs } from "./layout/Breadcrumbs";

const render = (element: ReactElement) => {
  const router = createMemoryRouter([{ path: "*", element }]);
  return renderToStaticMarkup(
    createElement(I18nProvider, { locale: "en" }, createElement(RouterProvider, { router })),
  );
};

describe("JsonLd", () => {
  it("renders one JSON-LD script that CMS text can't break out of", () => {
    const data = breadcrumbListLd("https://jassmin.ua", [
      { name: "</script><img src=x onerror=alert(1)>", to: "/" },
    ]);
    const html = renderToStaticMarkup(createElement(JsonLd, { data }));
    const match = /^<script type="application\/ld\+json">(.*)<\/script>$/s.exec(html);

    expect(match).not.toBeNull();
    expect(match?.[1]).not.toContain("<");
    expect(JSON.parse(match?.[1] ?? "")).toEqual(data);
  });
});

describe("Breadcrumbs", () => {
  it("links every crumb but the current page", () => {
    const html = render(
      createElement(Breadcrumbs, {
        items: [
          { name: "Home", to: "/" },
          { name: "Women's perfume", to: "/catalog/women" },
          { name: "Coco", to: "/products/x" },
        ],
      }),
    );

    expect(html).toContain('<nav aria-label="Breadcrumb"');
    expect(html).toContain("<ol");
    expect(html).toMatch(/<a [^>]*href="\/"[^>]*>Home<\/a>/);
    expect(html).toMatch(/<a [^>]*href="\/catalog\/women"[^>]*>Women&#x27;s perfume<\/a>/);
    expect(html).toMatch(/<span aria-current="page"[^>]*>Coco<\/span>/);
    expect(html).not.toContain('href="/products/x"');
  });
});
