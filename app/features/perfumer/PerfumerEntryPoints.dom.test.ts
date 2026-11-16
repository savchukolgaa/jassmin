// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createElement, type ReactElement } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { I18nProvider, type Locale } from "~/lib/i18n";
import { PerfumerEntryLink } from "./PerfumerEntryLink";

// The links into the AI perfumer chat (#165): the shared prefilled link, the catalog banner and
// empty state, and the product page's "find similar".

/** Renders `element` under a shop layout whose loader says whether the perfumer is enabled. */
function renderInShop(
  element: ReactElement,
  { enabled = true, locale = "uk" as Locale, url = "/" } = {},
) {
  const router = createMemoryRouter([{ id: "routes/_shop", path: "*", element }], {
    initialEntries: [url],
    hydrationData: { loaderData: { "routes/_shop": { perfumerEnabled: enabled } } },
  });
  return render(createElement(I18nProvider, { locale }, createElement(RouterProvider, { router })));
}

/** The `q` a link sends, decoded. */
function prefillOf(link: HTMLElement): string | null {
  return new URL(link.getAttribute("href") ?? "", "http://localhost").searchParams.get("q");
}

afterEach(cleanup);

describe("PerfumerEntryLink", () => {
  it("links to the chat in the page's language with the message in `q`, nofollow", () => {
    const message = "Схоже на Light Blue від Dolce & Gabbana";
    renderInShop(createElement(PerfumerEntryLink, { message }, "Запитати"));

    const link = screen.getByRole("link", { name: "Запитати" });
    expect(link.getAttribute("href")).toMatch(/^\/parfumer\?q=/);
    expect(prefillOf(link)).toBe(message);
    expect(link.getAttribute("rel")).toBe("nofollow");
  });

  it("uses the English chat path in English", () => {
    renderInShop(createElement(PerfumerEntryLink, { message: "Hi" }, "Ask"), {
      locale: "en",
    });
    expect(screen.getByRole("link", { name: "Ask" }).getAttribute("href")).toBe(
      "/en/perfumer?q=Hi",
    );
  });

  it("renders nothing while the perfumer is disabled", () => {
    renderInShop(createElement(PerfumerEntryLink, { message: "Hi" }, "Ask"), {
      enabled: false,
    });
    expect(screen.queryByRole("link")).toBeNull();
  });
});
