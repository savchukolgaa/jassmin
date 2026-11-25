// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, Fragment } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CartActionResult } from "~/lib/cart";
import { createTranslator, I18nProvider } from "~/lib/i18n";
import { AddToCartForm, type AddToCartFormProps, addedPromoMessage } from "./AddToCartForm";

// The add-to-cart form's options for the AI perfumer's cards (#169): its own fetcher per card,
// focus back on the button after adding, and the confirmation scrolled into view.

let release: () => void;

function renderForms(forms: AddToCartFormProps[]) {
  const page = createElement(
    Fragment,
    null,
    ...forms.map((props, index) => createElement(AddToCartForm, { key: index, ...props })),
  );
  const router = createMemoryRouter(
    [
      {
        path: "/koshyk",
        action: () =>
          new Promise<CartActionResult>((resolve) => {
            release = () => resolve({ ok: true, intent: "add" });
          }),
      },
      { path: "*", element: page },
    ],
    { initialEntries: ["/"] },
  );
  return render(
    createElement(I18nProvider, { locale: "uk" }, createElement(RouterProvider, { router })),
  );
}

const form = (props: Partial<AddToCartFormProps> = {}): AddToCartFormProps => ({
  productId: "p1",
  variantId: "v1",
  inStock: true,
  ...props,
});

let scrolled: ReturnType<typeof vi.fn>;

beforeEach(() => {
  scrolled = vi.fn();
  Element.prototype.scrollIntoView = scrolled as unknown as Element["scrollIntoView"];
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Submits the form behind `button` and lets the action answer. */
async function add(button: HTMLElement, { blur = false } = {}) {
  button.focus();
  await act(async () => fireEvent.click(button));
  // A disabled button loses focus in browsers (jsdom keeps it): simulate that.
  if (blur) (button as HTMLButtonElement).blur();
  await act(async () => release());
  await screen.findAllByText("Додано в кошик");
}

describe("AddToCartForm (#169)", () => {
  it("keeps forms for the same product apart when they have their own fetcher key", async () => {
    renderForms([form({ fetcherKey: "a" }), form({ fetcherKey: "b" })]);
    const [first] = screen.getAllByRole("button", { name: "Додати в кошик" });

    await add(first as HTMLElement);

    expect(screen.getAllByText("Додано в кошик")).toHaveLength(1);
  });

  it("shares the state between forms for one product by default", async () => {
    renderForms([form(), form()]);
    const [first] = screen.getAllByRole("button", { name: "Додати в кошик" });

    await add(first as HTMLElement);

    await waitFor(() => expect(screen.getAllByText("Додано в кошик")).toHaveLength(2));
  });

  it("gives the focus back to the button once the cart has answered", async () => {
    renderForms([form()]);
    const button = screen.getByRole("button", { name: "Додати в кошик" });

    await add(button, { blur: true });

    await waitFor(() => expect(document.activeElement).toBe(button));
  });

  it("scrolls the confirmation into view only when asked to", async () => {
    renderForms([form({ fetcherKey: "plain" })]);
    await add(screen.getByRole("button", { name: "Додати в кошик" }));
    expect(scrolled).not.toHaveBeenCalled();
    cleanup();

    renderForms([
      form({ fetcherKey: "revealed", revealResult: true, statusClassName: "scroll-mb-40" }),
    ]);
    await add(screen.getByRole("button", { name: "Додати в кошик" }));

    expect(scrolled).toHaveBeenCalledWith(expect.objectContaining({ block: "nearest" }));
    const status = screen.getByRole("status").parentElement;
    expect(status?.className).toContain("scroll-mb-40");
  });
});

describe("a promo code brought along (#191)", () => {
  it("posts the code as a hidden field only when there is one", () => {
    const { container } = renderForms([form({ promoCode: "TRY-7KQ2M9XD" }), form()]);
    const fields = container.querySelectorAll<HTMLInputElement>('input[name="promoCode"]');
    expect([...fields].map((field) => field.value)).toEqual(["TRY-7KQ2M9XD"]);
  });

  it("says whether the code took", () => {
    const uk = createTranslator("uk");
    const en = createTranslator("en");
    expect(addedPromoMessage({ code: "TRY-1", outcome: "applied" }, uk)).toBe(
      "Промокод TRY-1 застосовано.",
    );
    expect(addedPromoMessage({ code: "TRY-1", outcome: "not-best" }, en)).toMatch(/TRY-1/);
    expect(addedPromoMessage({ code: "TRY-1", outcome: "promo-not-applicable" }, en)).toBe(
      en.t("cart.errors.promoNotApplicable"),
    );
  });
});
