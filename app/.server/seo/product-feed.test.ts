// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  buildProductFeedXml,
  type FeedChannel,
  type FeedItem,
  GOOGLE_NS,
  productFeedChunks,
} from "./product-feed";

const channel: FeedChannel = {
  title: "JASSMIN",
  link: "https://jassmin.ua/",
  description: "Парфуми на розпив",
};
const options = { freeShippingThreshold: "1500.00 UAH" };

const item: FeedItem = {
  id: "0190a000-0000-7000-8000-000000000001",
  groupId: "0190a000-0000-7000-8000-000000000000",
  title: "Dolce & Gabbana Light Blue — розпив, 10 мл",
  description: "Свіжий <цитрусовий> аромат",
  link: "https://jassmin.ua/parfumy/light-blue",
  imageLink: "https://jassmin.ua/assets/shop-bottle-1280.jpg",
  additionalImageLinks: [],
  price: "629.00 UAH",
  availability: "in_stock",
  brand: "Dolce & Gabbana",
  productType: "Жіночі > Цитрусові",
  gender: "female",
  size: "10 мл",
};

/** Parses the XML strictly; a well-formedness error fails the test. */
function parse(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const error = doc.getElementsByTagName("parsererror")[0];
  if (error) throw new Error(`Invalid XML: ${error.textContent}`);
  return doc;
}

function items(doc: Document): Element[] {
  return [...doc.getElementsByTagName("item")];
}

function g(itemElement: Element, name: string): string[] {
  return [...itemElement.getElementsByTagNameNS(GOOGLE_NS, name)].map((el) => el.textContent ?? "");
}

function plain(itemElement: Element, name: string): string | null | undefined {
  return itemElement.getElementsByTagName(name)[0]?.textContent;
}

describe("buildProductFeedXml", () => {
  it("is well-formed RSS 2.0 with the g: namespace and the channel fields", () => {
    const doc = parse(buildProductFeedXml(channel, [item], options));
    expect(doc.documentElement.localName).toBe("rss");
    expect(doc.documentElement.getAttribute("version")).toBe("2.0");
    const channelElement = doc.getElementsByTagName("channel")[0];
    expect(channelElement?.getElementsByTagName("title")[0]?.textContent).toBe("JASSMIN");
  });

  it("prints every field of an item, escaping & and < so they round-trip", () => {
    const xml = buildProductFeedXml(channel, [item], options);
    expect(xml).toContain("<g:brand>Dolce &amp; Gabbana</g:brand>");
    const [parsed] = items(parse(xml));
    if (!parsed) throw new Error("No item");

    expect(g(parsed, "id")).toEqual([item.id]);
    expect(g(parsed, "item_group_id")).toEqual([item.groupId]);
    expect(plain(parsed, "title")).toBe(item.title);
    expect(plain(parsed, "description")).toBe(item.description);
    expect(plain(parsed, "link")).toBe(item.link);
    expect(g(parsed, "image_link")).toEqual([item.imageLink]);
    expect(g(parsed, "additional_image_link")).toEqual([]);
    expect(g(parsed, "price")).toEqual(["629.00 UAH"]);
    expect(g(parsed, "availability")).toEqual(["in_stock"]);
    expect(g(parsed, "brand")).toEqual(["Dolce & Gabbana"]);
    expect(g(parsed, "condition")).toEqual(["new"]);
    expect(g(parsed, "identifier_exists")).toEqual(["no"]);
    expect(g(parsed, "google_product_category")).toEqual(["479"]);
    expect(g(parsed, "product_type")).toEqual(["Жіночі > Цитрусові"]);
    expect(g(parsed, "gender")).toEqual(["female"]);
    expect(g(parsed, "size")).toEqual(["10 мл"]);
    expect(g(parsed, "country")).toEqual(["UA"]);
    expect(g(parsed, "price_threshold")).toEqual(["1500.00 UAH"]);
  });

  it("prints one item per input, in order, with additional images", () => {
    const second: FeedItem = {
      ...item,
      id: "second",
      availability: "out_of_stock",
      additionalImageLinks: ["https://jassmin.ua/a.jpg"],
    };
    const parsed = items(parse(buildProductFeedXml(channel, [item, second], options)));
    expect(parsed.map((el) => g(el, "id")[0])).toEqual([item.id, "second"]);
    expect(g(parsed[1] as Element, "availability")).toEqual(["out_of_stock"]);
    expect(g(parsed[1] as Element, "additional_image_link")).toEqual(["https://jassmin.ua/a.jpg"]);
  });

  it("stays well-formed when CMS text has control characters", () => {
    const broken: FeedItem = { ...item, description: "Опис\u0000 з\u000B керівними" };
    const [parsed] = items(parse(buildProductFeedXml(channel, [broken], options)));
    expect(plain(parsed as Element, "description")).toBe("Опис з керівними");
  });

  it("is a valid, empty channel without items", () => {
    const doc = parse(buildProductFeedXml(channel, [], options));
    expect(items(doc)).toEqual([]);
  });
});

describe("productFeedChunks", () => {
  it("yields the header, one chunk per item and the footer", () => {
    const chunks = [...productFeedChunks(channel, [item, item], options)];
    expect(chunks).toHaveLength(4);
    expect(chunks.join("")).toBe(buildProductFeedXml(channel, [item, item], options));
  });
});
