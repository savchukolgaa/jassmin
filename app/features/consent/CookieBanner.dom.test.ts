// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { I18nProvider } from "~/lib/i18n";
import { BOTTOM_UI_BANNER_VAR, CookieBanner } from "./CookieBanner";

// The banner's height as a CSS variable, for the AI perfumer corner button above it (#165).

const variable = () => document.documentElement.style.getPropertyValue(BOTTOM_UI_BANNER_VAR);

afterEach(cleanup);

describe("CookieBanner height", () => {
  it("is set on <html> while the banner shows and removed when it goes", () => {
    const router = createMemoryRouter([{ path: "*", element: createElement(CookieBanner) }]);
    const { unmount } = render(
      createElement(I18nProvider, { locale: "uk" }, createElement(RouterProvider, { router })),
    );

    // jsdom has no layout, so the height is 0px; what matters is that it's set.
    expect(variable()).toBe("0px");

    unmount();
    expect(variable()).toBe("");
  });
});
