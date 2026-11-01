// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { createMemoryRouter, RouterProvider, redirect } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { I18nProvider } from "~/lib/i18n";
import { LocaleSwitcher } from "./LocaleSwitcher";

// The switcher in the browser after hydration (#82): switching keeps the hash and the scroll
// position, while ordinary navigation still scrolls to the top.

/** Renders the switcher with a `/locale` action that records what it was posted and redirects back. */
function renderSwitcher(path: string) {
  const posted: FormData[] = [];
  const element = createElement(LocaleSwitcher, { tone: "onLight" });
  const router = createMemoryRouter(
    [
      { path: "/", element },
      { path: "/other", element },
      {
        path: "/locale",
        action: async ({ request }) => {
          const formData = await request.formData();
          posted.push(formData);
          return redirect(String(formData.get("redirectTo")));
        },
      },
    ],
    { initialEntries: [path] },
  );
  render(createElement(I18nProvider, { locale: "uk" }, createElement(RouterProvider, { router })));
  return { posted, router, user: userEvent.setup() };
}

afterEach(cleanup);

describe("LocaleSwitcher in the browser", () => {
  it("posts the current path, query and hash as redirectTo", async () => {
    const { posted, user } = renderSwitcher("/?page=2#location-title");

    await user.click(screen.getByRole("button", { name: "EN" }));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]?.get("locale")).toBe("en");
    expect(posted[0]?.get("redirectTo")).toBe("/?page=2#location-title");
  });

  it("comes back to the same URL without resetting the scroll position", async () => {
    const { posted, router, user } = renderSwitcher("/?page=2#location-title");

    await user.click(screen.getByRole("button", { name: "EN" }));

    await waitFor(() => {
      expect(posted).toHaveLength(1);
      expect(router.state.navigation.state).toBe("idle");
    });
    expect(router.state.location).toMatchObject({
      pathname: "/",
      search: "?page=2",
      hash: "#location-title",
    });
    expect(router.state.preventScrollReset).toBe(true);
  });

  it("leaves ordinary navigation to scroll to the top", async () => {
    const { router } = renderSwitcher("/");

    await router.navigate("/other");

    expect(router.state.location.pathname).toBe("/other");
    expect(router.state.preventScrollReset).toBe(false);
  });
});
