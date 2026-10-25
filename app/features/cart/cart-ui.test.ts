import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { type CartLine, EMPTY_CART } from "~/lib/cart";
import { createTranslator, I18nProvider } from "~/lib/i18n";
import { CartLineItem } from "./CartLineItem";
import { CartSummary, formatItemCount } from "./CartSummary";
import {
  cartLineFetcherKey,
  isPendingRemove,
  maxQuantity,
  optimisticQuantity,
  stockNotice,
} from "./cart-line-state";
import { EmptyCart } from "./EmptyCart";

// Fetchers and `<Form>` need a data router.
const render = (element: ReactElement) => {
  const router = createMemoryRouter([{ path: "/cart", element }], { initialEntries: ["/cart"] });
  // In English, like the assertions.
  return renderToStaticMarkup(
    createElement(I18nProvider, { locale: "en" }, createElement(RouterProvider, { router })),
  );
};

const form = (fields: Record<string, string>) => {
  const formData = new FormData();
  for (const [name, value] of Object.entries(fields)) formData.set(name, value);
  return formData;
};

const line: CartLine = {
  variantId: "01a1652b-6e25-7d00-8000-000000000050",
  productId: "01a1652b-6e25-7c03-ae47-25b57131fb06",
  title: "Coco Mademoiselle",
  brand: "Chanel",
  imageUrl: null,
  packSize: 1,
  volumeMl: 50,
  unitPrice: "6850.00",
  quantity: 2,
  stockQuantity: 6,
  lineTotal: "13700.00",
};

describe("cart line state", () => {
  it("shows the quantity being submitted while an update is in flight", () => {
    expect(optimisticQuantity(undefined, 2)).toBe(2);
    expect(optimisticQuantity(form({ intent: "update", quantity: "3" }), 2)).toBe(3);
    expect(optimisticQuantity(form({ intent: "update", quantity: "x" }), 2)).toBe(2);
    expect(optimisticQuantity(form({ intent: "remove" }), 2)).toBe(2);
  });

  it("hides a line while it's being removed", () => {
    expect(isPendingRemove(form({ intent: "remove" }))).toBe(true);
    expect(isPendingRemove(form({ intent: "update" }))).toBe(false);
    expect(isPendingRemove(undefined)).toBe(false);
  });

  it("caps the stepper at the stock and the per-line limit", () => {
    expect(maxQuantity({ stockQuantity: 6 })).toBe(6);
    expect(maxQuantity({ stockQuantity: 500 })).toBe(99);
    expect(maxQuantity({ stockQuantity: 0 })).toBe(0);
  });

  it("warns when the stock has dropped below the line's quantity", () => {
    const en = createTranslator("en");
    expect(stockNotice({ quantity: 2, stockQuantity: 6 }, en)).toBeNull();
    expect(stockNotice({ quantity: 4, stockQuantity: 3 }, en)).toBe(
      "Only 3 left. Lower the quantity to check out.",
    );
    expect(stockNotice({ quantity: 1, stockQuantity: 0 }, en)).toMatch(/out of stock/);
    expect(stockNotice({ quantity: 4, stockQuantity: 3 })).toBe(
      "Залишилося лише 3 шт. Зменште кількість, щоб оформити замовлення.",
    );
  });

  it("keys each line's fetcher by its variant", () => {
    expect(cartLineFetcherKey("abc")).toBe("cart-line-abc");
  });

  it("pluralises the item count", () => {
    const en = createTranslator("en");
    expect(formatItemCount(1, en)).toBe("1 item");
    expect(formatItemCount(3, en)).toBe("3 items");
    expect(formatItemCount(3)).toBe("3 товари");
    expect(formatItemCount(5)).toBe("5 товарів");
  });
});

describe("CartLineItem", () => {
  it("posts update and remove intents for its variant to the cart action", () => {
    const html = render(createElement(CartLineItem, { line }));

    expect(html.match(/<form[^>]*action="\/cart"/g)).toHaveLength(2);
    expect(html).toContain('name="intent" value="update"');
    expect(html).toContain('name="intent" value="remove"');
    expect(html.match(new RegExp(`name="variantId" value="${line.variantId}"`, "g"))).toHaveLength(
      2,
    );
    expect(html).toContain("50 ml");
    expect(html).toContain("₴6,850 each");
  });

  it("steps the quantity by one within the stock", () => {
    const html = render(createElement(CartLineItem, { line }));

    expect(html).toMatch(/<button type="submit" value="1"[^>]*name="quantity"/);
    expect(html).toMatch(/<button type="submit" value="3"[^>]*name="quantity"/);
    expect(html).not.toMatch(/<button[^>]*disabled=""/);
  });

  it("disables + at the stock and steps down to the stock when it has dropped", () => {
    const atStock = render(createElement(CartLineItem, { line: { ...line, stockQuantity: 2 } }));
    expect(atStock).toMatch(/<button[^>]*value="3"[^>]*disabled=""/);

    const above = render(
      createElement(CartLineItem, { line: { ...line, quantity: 5, stockQuantity: 2 } }),
    );
    expect(above).toMatch(/<button type="submit" value="2"[^>]*name="quantity"/);
    expect(above).toContain("Only 2 left");
  });

  it("disables − at one", () => {
    const html = render(createElement(CartLineItem, { line: { ...line, quantity: 1 } }));

    expect(html).toMatch(/<button[^>]*value="0"[^>]*disabled=""/);
  });
});

describe("CartSummary", () => {
  it("shows the item count, the subtotal and the checkout link", () => {
    const html = render(
      createElement(CartSummary, {
        cart: {
          ...EMPTY_CART,
          lines: [line],
          itemCount: 2,
          subtotal: "13700.00",
          total: "13700.00",
        },
      }),
    );

    expect(html).toContain("2 items");
    expect(html).toContain("₴13,700");
    expect(html).toMatch(/<a[^>]*href="\/checkout"[^>]*>Proceed to checkout<\/a>/);
  });
});

describe("EmptyCart", () => {
  it("links to the women's and men's catalogs only", () => {
    const html = render(createElement(EmptyCart));

    expect(html.match(/href="[^"]*"/g)).toEqual(['href="/catalog/women"', 'href="/catalog/men"']);
  });
});
