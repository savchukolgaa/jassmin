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
import { PromoCodeForm } from "./PromoCodeForm";

// Fetchers and `<Form>` need a data router.
const render = (element: ReactElement) => {
  const router = createMemoryRouter([{ path: "/en/cart", element }], {
    initialEntries: ["/en/cart"],
  });
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
  slug: "coco-mademoiselle",
  title: "Coco Mademoiselle",
  brand: "Chanel",
  image: null,
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

    expect(html.match(/<form[^>]*action="\/en\/cart"/g)).toHaveLength(2);
    expect(html).toContain('name="intent" value="update"');
    expect(html).toContain('name="intent" value="remove"');
    expect(html.match(new RegExp(`name="variantId" value="${line.variantId}"`, "g"))).toHaveLength(
      2,
    );
    expect(html).toContain("50 ml");
    expect(html).toContain("₴6,850 each");
  });

  it("links to the product's slug URL", () => {
    const html = render(createElement(CartLineItem, { line }));

    expect(html).toContain('href="/en/perfumes/coco-mademoiselle"');
    expect(html).not.toContain(`/en/perfumes/${line.productId}`);
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
    expect(html).toMatch(/<a[^>]*href="\/en\/checkout"[^>]*>Proceed to checkout<\/a>/);
    expect(html).toContain("Free Nova Poshta delivery from ₴1,500.");
  });
});

describe("CartSummary with a discount (#59)", () => {
  const trio = {
    ...EMPTY_CART,
    lines: [{ ...line, volumeMl: 10, unitPrice: "790.00", quantity: 3, lineTotal: "2370.00" }],
    itemCount: 3,
    subtotal: "2370.00",
    discount: { amount: "1871.00", code: null, kind: "fixed_price_set" as const },
    total: "499.00",
  };

  it("shows the subtotal, the trio's saving and the total", () => {
    const html = render(createElement(CartSummary, { cart: trio }));

    expect(html).toContain("Subtotal");
    expect(html).toContain("₴2,370");
    expect(html).toContain("Tester trio 3 × 10 ml");
    expect(html).toContain("−₴1,871");
    expect(html).toMatch(/Total<\/dt><dd class="font-serif font-bold">₴499<\/dd>/);
  });

  it("names the promo code and reads in Ukrainian by default", () => {
    const router = createMemoryRouter(
      [
        {
          path: "/en/cart",
          element: createElement(CartSummary, {
            cart: {
              ...trio,
              discount: { amount: "79.00", code: "JASSMIN10", kind: "percent" as const },
              total: "2291.00",
              promo: { code: "JASSMIN10", status: "applied" as const },
            },
          }),
        },
      ],
      { initialEntries: ["/en/cart"] },
    );
    const html = renderToStaticMarkup(
      createElement(I18nProvider, { locale: "uk" }, createElement(RouterProvider, { router })),
    ).replace(/\s/gu, " ");

    expect(html).toContain("Знижка (промокод JASSMIN10)");
    expect(html).toContain("−79 ₴");
    expect(html).toContain("До сплати");
    expect(html).toContain("Промокод JASSMIN10 застосовано.");
    expect(html).toContain("Безкоштовна доставка Новою Поштою від 1 500 ₴.");
  });
});

describe("PromoCodeForm", () => {
  it("offers a labelled code field that posts apply-promo to the cart", () => {
    const html = render(createElement(PromoCodeForm, { promo: null }));

    expect(html).toMatch(/<form[^>]*action="\/en\/cart" method="post"/);
    expect(html).toContain('name="intent" value="apply-promo"');
    expect(html).toMatch(/<label for="cart-promo-code"[^>]*>Promo code<\/label>/);
    expect(html).toMatch(/<input[^>]*maxLength="40"[^>]*name="code"/);
    expect(html).toContain(">Apply</button>");
  });

  it("says what the stored code does and offers to remove it", () => {
    const cases = [
      ["applied", "Promo code SAVE applied."],
      ["not-best", "Promo code SAVE isn&#x27;t used: a better offer already applies to your cart."],
      ["not-applicable", "Promo code SAVE doesn&#x27;t apply to the items in your cart."],
      ["expired", "Promo code SAVE has expired."],
      ["used-up", "Promo code SAVE is no longer valid."],
      ["invalid", "Promo code SAVE is no longer valid."],
    ] as const;
    for (const [status, text] of cases) {
      const html = render(createElement(PromoCodeForm, { promo: { code: "SAVE", status } }));
      expect(html).toContain(text);
      expect(html).toContain('name="intent" value="remove-promo"');
      expect(html).toContain("Remove promo code SAVE");
      expect(html).not.toContain('name="code"');
    }
  });
});

describe("EmptyCart", () => {
  it("links to the women's and men's catalogs only", () => {
    const html = render(createElement(EmptyCart));

    expect(html.match(/href="[^"]*"/g)).toEqual([
      'href="/en/catalog/women"',
      'href="/en/catalog/men"',
    ]);
  });
});
