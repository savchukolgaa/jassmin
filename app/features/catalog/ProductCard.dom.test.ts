// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import type { CartActionResult } from "~/lib/cart";
import { I18nProvider } from "~/lib/i18n";
import type { ProductSummary } from "~/lib/products";
import { ProductCard } from "./ProductCard";

// The card in the browser after hydration (#74): picking a size, its price and what the form posts.

const PRODUCT: ProductSummary = {
  id: "01a1652b-6e25-7c03-ae47-25b57131fb06",
  slug: "coco-mademoiselle-eau-de-parfum",
  title: "Coco Mademoiselle Eau de Parfum",
  brand: "Chanel",
  gender: "women",
  packSize: 1,
  imageUrl: null,
  variants: [
    { id: "v5", volumeMl: 5, price: "990.00", inStock: true },
    { id: "v10", volumeMl: 10, price: "1350.00", inStock: false },
    { id: "v30", volumeMl: 30, price: "4450.00", inStock: true },
    { id: "v50", volumeMl: 50, price: "6850.00", inStock: true },
  ],
  minPrice: "990.00",
  hasPriceRange: true,
  volumes: [7, 10, 30, 50],
  inStock: true,
  defaultVariant: { id: "v5", volumeMl: 5 },
  fragranceFamily: null,
};

/** Renders the card with a `/cart` action that records what it was posted. */
function renderCard(variant: "default" | "compact" = "default") {
  const posted: FormData[] = [];
  const router = createMemoryRouter([
    { path: "/", element: createElement(ProductCard, { product: PRODUCT, variant }) },
    {
      path: "/cart",
      action: async ({ request }): Promise<CartActionResult> => {
        posted.push(await request.formData());
        return { ok: true, intent: "add" };
      },
    },
  ]);
  const { container } = render(
    createElement(I18nProvider, { locale: "en" }, createElement(RouterProvider, { router })),
  );
  return { posted, container, user: userEvent.setup() };
}

const radio = (name: RegExp) => screen.getByRole<HTMLInputElement>("radio", { name });

afterEach(cleanup);

describe.each(["default", "compact"] as const)("ProductCard (%s) in the browser", (variant) => {
  it("shows the default size's price once hydrated, without the skeleton", () => {
    const { container } = renderCard(variant);

    expect(container.querySelector("[data-price-skeleton]")).toBeNull();
    expect(container.textContent).toContain("₴990");
    expect(container.textContent).not.toContain("from");
    expect(radio(/^5 ml/).checked).toBe(true);
  });

  it("shows the price of the size the shopper picks", async () => {
    const { container, user } = renderCard(variant);

    await user.click(radio(/^30 ml/));

    expect(radio(/^30 ml/).checked).toBe(true);
    expect(container.textContent).toContain("₴4,450");
    expect(container.textContent).not.toContain("₴990");
  });

  it("can't pick a sold-out size", async () => {
    const { container, user } = renderCard(variant);
    const soldOut = radio(/^10 ml, out of stock/);

    expect(soldOut.disabled).toBe(true);
    await user.click(soldOut);

    expect(soldOut.checked).toBe(false);
    expect(radio(/^5 ml/).checked).toBe(true);
    expect(container.textContent).toContain("₴990");
  });

  it("moves between sizes with the arrow keys, skipping sold-out ones", async () => {
    const { container, user } = renderCard(variant);

    radio(/^5 ml/).focus();
    await user.keyboard("{ArrowRight}");

    expect(radio(/^30 ml/).checked).toBe(true);
    expect(document.activeElement).toBe(radio(/^30 ml/));
    expect(container.textContent).toContain("₴4,450");
  });

  it("adds the picked size to the cart", async () => {
    const { posted, user } = renderCard(variant);

    await user.click(radio(/^50 ml/));
    await user.click(screen.getByRole("button", { name: /add/i }));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]?.get("intent")).toBe("add");
    expect(posted[0]?.get("productId")).toBe(PRODUCT.id);
    expect(posted[0]?.getAll("variantId")).toEqual(["v50"]);
    expect(await screen.findByRole("status")).toBeTruthy();
  });
});
