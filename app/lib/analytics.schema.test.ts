import { describe, expect, it } from "vitest";
import { type EventProperties, MAX_DWELL_MS } from "./analytics";
import { clientEventBatchSchema, parseEventProperties } from "./analytics.schema";
import type { EventType } from "./enums";
import { EVENT_TYPES } from "./enums";

const PRODUCT = "01a1652b-6e25-7c03-ae47-25b57131fb06";
const VARIANT = "01a1652b-6e25-7d00-8000-000000000050";
const SEARCH = "0b6f1b8e-3f7e-4a52-9a43-3c1f7f1f2c11";

const product = {
  product_public_id: PRODUCT,
  variant_id: VARIANT,
  volume_ml: 50,
  price: "1890.00",
  in_stock: true,
};
const listed = { ...product, list_id: "search", list_position: 13, search_id: SEARCH };

/** One valid example of every event type: the contract `docs/analytics-events.md` shows. */
const VALID: { [T in EventType]: EventProperties<T> } = {
  page_view: { path: "/catalog/women?sort=newest" },
  product_view: product,
  product_impression: { ...product, list_id: "search", list_position: 13, search_id: SEARCH },
  product_click: { ...product, list_id: "home", list_position: 2 },
  product_dwell: { ...product, dwell_ms: 42_000, max_scroll_pct: 80 },
  search: {
    search_id: SEARCH,
    query: null,
    gender: "women",
    fragrance_family: "Квіткові",
    brand: null,
    sort: "price_asc",
    page: 2,
    result_count: 31,
    product_public_ids: [PRODUCT],
  },
  add_to_cart: { ...product, quantity: 1, cart_value_after: "1890.00", list_id: "catalog" },
  remove_from_cart: { ...product, quantity: 2, cart_value_after: "0.00", source: "stepper" },
  checkout_start: {
    subtotal: "1890.00",
    item_count: 1,
    discount_amount: "0.00",
    discount_code: null,
  },
  purchase: {
    order_id: 42,
    subtotal: "1890.00",
    total_amount: "1701.00",
    discount_amount: "189.00",
    discount_id: 3,
    discount_code: "JASSMIN10",
    gift_card_amount: "0.00",
    payment_method: "cod",
    items: [
      { variant_id: VARIANT, quantity: 1, unit_price: "1890.00", discount_allocated: "189.00" },
    ],
    is_first_order: true,
  },
  login: { method: "register" },
  review_submit: { product_public_id: PRODUCT },
};

describe("parseEventProperties", () => {
  it.each(EVENT_TYPES)("accepts a valid %s", (type) => {
    expect(parseEventProperties(type, VALID[type])).toEqual(VALID[type]);
  });

  it.each(EVENT_TYPES)("rejects a %s with an unknown key, so no personal data gets in", (type) => {
    expect(parseEventProperties(type, { ...VALID[type], email: "olena@example.com" })).toBeNull();
  });

  it.each(EVENT_TYPES)("rejects a %s without properties", (type) => {
    expect(parseEventProperties(type, undefined)).toBeNull();
    expect(parseEventProperties(type, {})).toBeNull();
  });

  it("rejects the old camelCase keys", () => {
    expect(parseEventProperties("product_view", { publicId: PRODUCT })).toBeNull();
    expect(parseEventProperties("checkout_start", { subtotal: "1.00", itemCount: 1 })).toBeNull();
  });

  it("needs the list and a 1-based position on impressions and clicks", () => {
    expect(parseEventProperties("product_impression", product)).toBeNull();
    expect(parseEventProperties("product_click", { ...listed, list_position: 0 })).toBeNull();
    expect(parseEventProperties("product_click", { ...listed, list_id: "wishlist" })).toBeNull();
    expect(parseEventProperties("product_click", { ...listed, search_id: "abc" })).toBeNull();
  });

  it("takes prices only as exact decimal strings", () => {
    for (const price of ["1890", "1890.5", 1890, "-1.00", "1,890.00"]) {
      expect(parseEventProperties("product_view", { ...product, price })).toBeNull();
    }
    expect(parseEventProperties("product_view", { ...product, price: null })).not.toBeNull();
  });

  it("caps dwell time at 30 minutes and scroll depth at 100%", () => {
    const dwell = VALID.product_dwell;
    expect(parseEventProperties("product_dwell", { ...dwell, dwell_ms: MAX_DWELL_MS })).not.toBe(
      null,
    );
    expect(parseEventProperties("product_dwell", { ...dwell, dwell_ms: MAX_DWELL_MS + 1 })).toBe(
      null,
    );
    expect(parseEventProperties("product_dwell", { ...dwell, max_scroll_pct: 101 })).toBeNull();
    expect(parseEventProperties("product_dwell", { ...dwell, dwell_ms: 1.5 })).toBeNull();
  });

  it("lists at most 24 search results", () => {
    const ids = Array.from({ length: 25 }, () => PRODUCT);
    expect(parseEventProperties("search", { ...VALID.search, product_public_ids: ids })).toBeNull();
  });

  it("needs at least one line on a purchase", () => {
    expect(parseEventProperties("purchase", { ...VALID.purchase, items: [] })).toBeNull();
  });
});

describe("clientEventBatchSchema product events (#129)", () => {
  const event = (type: string, properties: unknown) => ({
    type,
    path: "/en/catalog/women",
    properties,
  });

  it("accepts impressions, clicks and dwell with their properties", () => {
    const events = [
      event("product_impression", VALID.product_impression),
      event("product_click", VALID.product_click),
      event("product_dwell", VALID.product_dwell),
    ];
    expect(clientEventBatchSchema.safeParse({ events }).success).toBe(true);
  });

  it("rejects a product event without or with the wrong properties", () => {
    for (const bad of [
      { type: "product_impression", path: "/" },
      event("product_impression", VALID.product_dwell),
      event("product_click", product),
    ]) {
      expect(clientEventBatchSchema.safeParse({ events: [bad] }).success).toBe(false);
    }
  });

  it("still refuses product events only the server records", () => {
    expect(
      clientEventBatchSchema.safeParse({ events: [event("product_view", product)] }).success,
    ).toBe(false);
    expect(
      clientEventBatchSchema.safeParse({ events: [event("add_to_cart", VALID.add_to_cart)] })
        .success,
    ).toBe(false);
  });
});
