// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { SHOP_BOTTLE_FEED_IMAGE_URL } from "~/lib/shop-bottle";
import type { FeedVariantRow } from "../db/queries/products";
import { GOOGLE_NS } from "../seo/product-feed";
import {
  FEED_DESCRIPTION_MAX_LENGTH,
  feedChannel,
  feedItems,
  getProductFeed,
  truncateText,
} from "./product-feed";

const SITE = "https://jassmin.ua";
const uk = { locale: "uk", siteUrl: SITE } as const;
const en = { locale: "en", siteUrl: SITE } as const;

function row(overrides: Partial<FeedVariantRow> = {}): FeedVariantRow {
  return {
    productId: "0190a000-0000-7000-8000-000000000000",
    slug: "light-blue",
    title: "Light Blue",
    brand: "Dolce & Gabbana",
    gender: "women",
    fragranceFamily: "цитрусові",
    packSize: 1,
    description: "Свіжий цитрусовий аромат.\n\nДругий абзац.",
    descriptionEn: "A fresh citrus scent.",
    imageUrl: null,
    imageWidth: null,
    imageHeight: null,
    imageFormats: null,
    variantId: "0190a000-0000-7000-8000-000000000001",
    volumeMl: 10,
    price: "629.00",
    stock: 4,
    ...overrides,
  };
}

function only<T>(items: T[]): T {
  const [first] = items;
  if (items.length !== 1 || first === undefined)
    throw new Error(`Expected one, got ${items.length}`);
  return first;
}

describe("feedItems", () => {
  it("maps a size to an item with its ids, price, link and size in Ukrainian", () => {
    const item = only(feedItems([row()], uk));
    expect(item).toMatchObject({
      id: "0190a000-0000-7000-8000-000000000001",
      groupId: "0190a000-0000-7000-8000-000000000000",
      title: "Dolce & Gabbana Light Blue — розпив, 10 мл",
      link: "https://jassmin.ua/parfumy/light-blue",
      price: "629.00 UAH",
      availability: "in_stock",
      brand: "Dolce & Gabbana",
      productType: "Жіночі парфуми > Цитрусові",
      gender: "female",
      size: "10 мл",
    });
  });

  it("uses English copy, links and the English description in the English feed", () => {
    const item = only(feedItems([row()], en));
    expect(item.title).toBe("Dolce & Gabbana Light Blue — decant, 10 ml");
    expect(item.link).toBe("https://jassmin.ua/en/perfumes/light-blue");
    expect(item.productType).toBe("Women's perfume > Citrus");
    expect(item.size).toBe("10 ml");
    expect(item.description).toBe(
      "Original Dolce & Gabbana Light Blue perfume, decanted into a JASSMIN bottle, 10 ml. A fresh citrus scent.",
    );
  });

  it("says it's a decant, then gives the description on one line", () => {
    expect(only(feedItems([row()], uk)).description).toBe(
      "Оригінальний аромат Dolce & Gabbana Light Blue, розлитий у флакон JASSMIN, 10 мл. Свіжий цитрусовий аромат. Другий абзац.",
    );
  });

  it("falls back to the other language's description, then to the decant note alone", () => {
    expect(only(feedItems([row({ descriptionEn: null })], en)).description).toContain(
      "Свіжий цитрусовий аромат.",
    );
    expect(only(feedItems([row({ description: " ", descriptionEn: null })], uk)).description).toBe(
      "Оригінальний аромат Dolce & Gabbana Light Blue, розлитий у флакон JASSMIN, 10 мл.",
    );
  });

  it("cuts a long description to Google's 5000 characters", () => {
    const item = only(feedItems([row({ description: "слово ".repeat(2000) })], uk));
    expect(item.description.length).toBeLessThanOrEqual(FEED_DESCRIPTION_MAX_LENGTH);
    expect(item.description.endsWith("…")).toBe(true);
  });

  it("is out of stock with no selling stock", () => {
    expect(only(feedItems([row({ stock: 0 })], uk)).availability).toBe("out_of_stock");
  });

  it("shows the bottle JPEG by default, and the product's own photo first when it has one", () => {
    const bottle = `${SITE}${SHOP_BOTTLE_FEED_IMAGE_URL}`;
    expect(only(feedItems([row()], uk))).toMatchObject({
      imageLink: bottle,
      additionalImageLinks: [],
    });
    expect(
      only(feedItems([row({ imageUrl: "https://cms.jassmin.ua/uploads/light_blue.jpg" })], uk)),
    ).toMatchObject({
      imageLink: "https://cms.jassmin.ua/uploads/light_blue.jpg",
      additionalImageLinks: [bottle],
    });
  });

  it("leaves the family out of the product type when there's none", () => {
    expect(only(feedItems([row({ fragranceFamily: null, gender: "unisex" })], uk))).toMatchObject({
      productType: "Унісекс парфуми",
      gender: "unisex",
    });
  });

  it("names a pack's size with its units, and doesn't repeat a brand already in the title", () => {
    const item = only(
      feedItems([row({ packSize: 3, volumeMl: 5, title: "Dolce & Gabbana Light Blue" })], uk),
    );
    expect(item.size).toBe("3 × 5 мл");
    expect(item.title).toBe("Dolce & Gabbana Light Blue — розпив, 3 × 5 мл");
  });

  it("makes one item per size, in order", () => {
    const items = feedItems(
      [row({ variantId: "a", volumeMl: 5 }), row({ variantId: "b", volumeMl: 10 })],
      uk,
    );
    expect(items.map((item) => [item.id, item.size])).toEqual([
      ["a", "5 мл"],
      ["b", "10 мл"],
    ]);
  });
});

describe("feedChannel", () => {
  it("links the home page in the feed's language", () => {
    expect(feedChannel(uk).link).toBe("https://jassmin.ua/");
    expect(feedChannel({ ...en, siteUrl: `${SITE}/` }).link).toBe("https://jassmin.ua/en");
  });
});

describe("truncateText", () => {
  it("keeps short text and cuts long text at a space", () => {
    expect(truncateText("short", 10)).toBe("short");
    expect(truncateText("one two three four", 12)).toBe("one two…");
  });
});

describe("getProductFeed", () => {
  it("is well-formed XML with one item per row and the free shipping threshold", async () => {
    const chunks = await getProductFeed(uk, {
      listVariants: async () => [row({ variantId: "a" }), row({ variantId: "b" })],
    });
    const doc = new DOMParser().parseFromString([...chunks].join(""), "application/xml");
    expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
    const ids = [...doc.getElementsByTagNameNS(GOOGLE_NS, "id")].map((el) => el.textContent);
    expect(ids).toEqual(["a", "b"]);
    expect(doc.getElementsByTagNameNS(GOOGLE_NS, "price_threshold")[0]?.textContent).toBe(
      "1500.00 UAH",
    );
  });
});
