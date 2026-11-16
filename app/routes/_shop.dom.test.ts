// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LOGGED_OUT_HEADER } from "~/lib/header";
import { I18nProvider } from "~/lib/i18n";

// The shop layout renders the AI perfumer corner button only while the perfumer is enabled (#165).

vi.mock("~/.server/ai/config", () => ({}));
vi.mock("~/.server/analytics-middleware", () => ({ visitorMiddleware: vi.fn() }));
vi.mock("~/.server/cms/social", () => ({}));
vi.mock("~/.server/consent", () => ({}));
vi.mock("~/.server/locale", () => ({}));
vi.mock("~/.server/services/header", () => ({}));

const { default: ShopLayout } = await import("./_shop");

type LayoutProps = Parameters<typeof ShopLayout>[0];

function renderLayout(perfumerEnabled: boolean, consent: "granted" | null = "granted") {
  const loaderData = {
    header: LOGGED_OUT_HEADER,
    consent,
    suggestEnglish: false,
    socialLinks: [],
    perfumerEnabled,
  };
  const router = createMemoryRouter(
    [
      {
        id: "routes/_shop",
        path: "/",
        loader: () => loaderData,
        element: createElement(() =>
          createElement(ShopLayout, { loaderData } as unknown as LayoutProps),
        ),
        children: [{ path: "*", element: createElement("main", null, "Сторінка") }],
      },
    ],
    {
      initialEntries: ["/aktsii"],
      hydrationData: { loaderData: { "routes/_shop": loaderData } },
    },
  );
  return render(
    createElement(I18nProvider, { locale: "uk" }, createElement(RouterProvider, { router })),
  );
}

const corner = () => screen.queryByRole("link", { name: "Запитати AI парфумера" });

afterEach(cleanup);

describe("ShopLayout corner button", () => {
  it("is shown while the perfumer is enabled, after the footer", () => {
    renderLayout(true);
    const link = corner();
    expect(link).not.toBeNull();
    const footer = document.querySelector("footer");
    expect(footer?.compareDocumentPosition(link as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("is absent while the perfumer is disabled", () => {
    renderLayout(false);
    expect(corner()).toBeNull();
  });

  it("makes room for the cookie banner and comes before it in the tab order", () => {
    renderLayout(true, null);
    const link = corner();
    expect(link?.hasAttribute("data-cookie-banner")).toBe(true);
    const banner = screen.getByRole("region", { name: "Ми використовуємо файли cookie" });
    expect(link?.compareDocumentPosition(banner)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});
