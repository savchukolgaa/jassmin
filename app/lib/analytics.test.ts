import { describe, expect, it } from "vitest";
import {
  absoluteListPosition,
  MAX_CLIENT_EVENTS,
  productEventContext,
  resolveDeviceType,
  resolveTrafficAttribution,
} from "./analytics";
import { clientEventBatchSchema } from "./analytics.schema";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const ANDROID_PHONE =
  "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
const ANDROID_TABLET =
  "Mozilla/5.0 (Linux; Android 15; SM-X910) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const IPAD =
  "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const DESKTOP =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

describe("resolveDeviceType", () => {
  it("tells phones, tablets and desktops apart", () => {
    expect(resolveDeviceType(IPHONE)).toBe("mobile");
    expect(resolveDeviceType(ANDROID_PHONE)).toBe("mobile");
    expect(resolveDeviceType(ANDROID_TABLET)).toBe("tablet");
    expect(resolveDeviceType(IPAD)).toBe("tablet");
    expect(resolveDeviceType(DESKTOP)).toBe("desktop");
  });

  it("is null without a user agent", () => {
    expect(resolveDeviceType(null)).toBeNull();
    expect(resolveDeviceType("")).toBeNull();
  });
});

describe("resolveTrafficAttribution", () => {
  it("uses the UTM tags", () => {
    const url = new URL(
      "https://jassmin.ua/?utm_source=Instagram&utm_medium=CPC&utm_campaign=autumn",
    );
    expect(resolveTrafficAttribution(url, "https://l.instagram.com/")).toEqual({
      source: "instagram",
      medium: "cpc",
      campaign: "autumn",
    });
  });

  it("leaves the medium empty when only utm_source is set", () => {
    const url = new URL("https://jassmin.ua/?utm_source=newsletter");
    expect(resolveTrafficAttribution(url, null)).toEqual({
      source: "newsletter",
      medium: null,
      campaign: null,
    });
  });

  it("counts another site as a referral", () => {
    const url = new URL("https://jassmin.ua/catalog/women");
    expect(resolveTrafficAttribution(url, "https://www.google.com/search?q=x")).toEqual({
      source: "google.com",
      medium: "referral",
      campaign: null,
    });
  });

  it("is direct without tags or an external referrer", () => {
    const url = new URL("https://jassmin.ua/blog");
    const direct = { source: "direct", medium: "none", campaign: null };
    expect(resolveTrafficAttribution(url, null)).toEqual(direct);
    expect(resolveTrafficAttribution(url, "https://jassmin.ua/")).toEqual(direct);
    expect(resolveTrafficAttribution(url, "not a url")).toEqual(direct);
  });
});

describe("clientEventBatchSchema", () => {
  const pageView = { type: "page_view", path: "/catalog/women?sort=newest", referrer: "/" };

  it("accepts a batch of page views", () => {
    expect(clientEventBatchSchema.safeParse({ events: [pageView] }).success).toBe(true);
  });

  it("rejects event types only the server records", () => {
    const purchase = { ...pageView, type: "purchase" };
    expect(clientEventBatchSchema.safeParse({ events: [purchase] }).success).toBe(false);
  });

  it("rejects empty and oversized batches", () => {
    expect(clientEventBatchSchema.safeParse({ events: [] }).success).toBe(false);
    const events = Array.from({ length: MAX_CLIENT_EVENTS + 1 }, () => pageView);
    expect(clientEventBatchSchema.safeParse({ events }).success).toBe(false);
  });

  it("rejects paths on other sites", () => {
    for (const path of ["https://evil.com/", "//evil.com/", "/\\evil.com", "a"]) {
      const event = { type: "page_view", path };
      expect(clientEventBatchSchema.safeParse({ events: [event] }).success).toBe(false);
    }
    const tooLong = { type: "page_view", path: `/${"a".repeat(2048)}` };
    expect(clientEventBatchSchema.safeParse({ events: [tooLong] }).success).toBe(false);
  });
});

describe("absoluteListPosition (#129)", () => {
  it("counts from 1 across pages", () => {
    expect(absoluteListPosition(1, 12, 0)).toBe(1);
    expect(absoluteListPosition(1, 12, 11)).toBe(12);
    expect(absoluteListPosition(2, 12, 0)).toBe(13);
    expect(absoluteListPosition(0, 12, 3)).toBe(4);
  });
});

describe("productEventContext (#129)", () => {
  const variants = [
    { id: "v5", volumeMl: 5, price: "290.00", inStock: false },
    { id: "v10", volumeMl: 10, price: "490.00", inStock: true },
    { id: "v50", volumeMl: 50, price: "1890.00", inStock: true },
  ];
  const product = { id: "p1", variants };

  it("describes the preselected size: the smallest one in stock", () => {
    expect(productEventContext(product)).toEqual({
      product_public_id: "p1",
      variant_id: "v10",
      volume_ml: 10,
      price: "490.00",
      in_stock: true,
    });
  });

  it("describes the picked size and the list it was shown in", () => {
    expect(
      productEventContext(product, "v50", { list_id: "home", list_position: 3 }),
    ).toMatchObject({ variant_id: "v50", price: "1890.00", list_id: "home", list_position: 3 });
    expect(productEventContext(product, "unknown")).toMatchObject({ variant_id: "v10" });
  });

  it("has no size, price or stock for a product without sizes", () => {
    expect(productEventContext({ id: "p2", variants: [] })).toEqual({
      product_public_id: "p2",
      variant_id: null,
      volume_ml: null,
      price: null,
      in_stock: false,
    });
  });
});
