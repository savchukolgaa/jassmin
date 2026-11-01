import { describe, expect, it } from "vitest";
import {
  absoluteUrl,
  blogPostingLd,
  breadcrumbListLd,
  type ProductLdInput,
  parseOpeningHours,
  productLd,
  type StoreLocationInput,
  serializeJsonLd,
  storeGraphLd,
  truncateWords,
} from "./structured-data";

const ORIGIN = "https://jassmin.ua";

describe("serializeJsonLd", () => {
  it("escapes every less-than sign so CMS text can't close the script tag", () => {
    const data = breadcrumbListLd(ORIGIN, [
      { name: "</script><script>alert(1)</script>", to: "/" },
    ]);
    const json = serializeJsonLd(data);

    expect(json).not.toContain("<");
    expect(json).toContain("\\u003c/script>");
    expect(JSON.parse(json)).toEqual(data);
  });

  it("escapes line and paragraph separators", () => {
    const data = breadcrumbListLd(ORIGIN, [{ name: "a\u2028b\u2029c", to: "/" }]);
    const json = serializeJsonLd(data);

    expect(json).not.toMatch(/[\u2028\u2029]/);
    expect(JSON.parse(json)).toEqual(data);
  });
});

describe("absoluteUrl", () => {
  it("resolves site paths against the origin and keeps absolute URLs", () => {
    expect(absoluteUrl(ORIGIN, "/catalog/women")).toBe("https://jassmin.ua/catalog/women");
    expect(absoluteUrl(`${ORIGIN}/`, "/")).toBe("https://jassmin.ua/");
    expect(absoluteUrl(ORIGIN, "images/a.jpg")).toBe("https://jassmin.ua/images/a.jpg");
    expect(absoluteUrl(ORIGIN, "https://cms.jassmin.ua/uploads/a.jpg")).toBe(
      "https://cms.jassmin.ua/uploads/a.jpg",
    );
  });
});

const productInput = (overrides: Partial<ProductLdInput["product"]> = {}): ProductLdInput => ({
  origin: ORIGIN,
  path: "/products/01a1652b-6e25-7c03-ae47-25b57131fb06",
  variantName: ({ volumeMl }) => `${volumeMl} мл`,
  product: {
    title: "Coco Mademoiselle Eau de Parfum",
    brand: "Chanel",
    packSize: 1,
    imageUrl: "/images/coco.jpg",
    description: "Свіжий шипровий аромат.",
    storeCode: "3-D",
    variants: [
      { volumeMl: 10, price: "1350.00", inStock: true },
      { volumeMl: 50, price: "6850.00", inStock: false },
    ],
    ...overrides,
  },
});

describe("productLd", () => {
  it("builds a Product with one UAH offer per size", () => {
    expect(productLd(productInput())).toMatchInlineSnapshot(`
      {
        "@context": "https://schema.org",
        "@type": "Product",
        "brand": {
          "@type": "Brand",
          "name": "Chanel",
        },
        "description": "Свіжий шипровий аромат.",
        "image": "https://jassmin.ua/images/coco.jpg",
        "name": "Coco Mademoiselle Eau de Parfum",
        "offers": [
          {
            "@type": "Offer",
            "availability": "https://schema.org/InStock",
            "itemCondition": "https://schema.org/NewCondition",
            "name": "10 мл",
            "price": "1350.00",
            "priceCurrency": "UAH",
            "seller": {
              "@type": "Organization",
              "name": "Jassmin",
              "url": "https://jassmin.ua/",
            },
            "url": "https://jassmin.ua/products/01a1652b-6e25-7c03-ae47-25b57131fb06",
          },
          {
            "@type": "Offer",
            "availability": "https://schema.org/OutOfStock",
            "itemCondition": "https://schema.org/NewCondition",
            "name": "50 мл",
            "price": "6850.00",
            "priceCurrency": "UAH",
            "seller": {
              "@type": "Organization",
              "name": "Jassmin",
              "url": "https://jassmin.ua/",
            },
            "url": "https://jassmin.ua/products/01a1652b-6e25-7c03-ae47-25b57131fb06",
          },
        ],
        "sku": "3-D",
        "url": "https://jassmin.ua/products/01a1652b-6e25-7c03-ae47-25b57131fb06",
      }
    `);
  });

  it("leaves out a missing image, description and store code", () => {
    const ld = productLd(productInput({ imageUrl: null, description: "  ", storeCode: null }));

    expect(ld).not.toHaveProperty("image");
    expect(ld).not.toHaveProperty("description");
    expect(ld).not.toHaveProperty("sku");
  });

  it("returns null for a product without sizes", () => {
    expect(productLd(productInput({ variants: [] }))).toBeNull();
  });

  it("never invents ratings or reviews", () => {
    const json = serializeJsonLd(productLd(productInput()) ?? breadcrumbListLd(ORIGIN, []));

    expect(json).not.toContain("aggregateRating");
    expect(json).not.toContain("review");
  });
});

describe("breadcrumbListLd", () => {
  it("numbers the trail from 1 with absolute URLs", () => {
    expect(
      breadcrumbListLd(ORIGIN, [
        { name: "Головна", to: "/" },
        { name: "Жіночі парфуми", to: "/catalog/women" },
        { name: "Coco", to: "/products/x" },
      ]),
    ).toMatchInlineSnapshot(`
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
          {
            "@type": "ListItem",
            "item": "https://jassmin.ua/",
            "name": "Головна",
            "position": 1,
          },
          {
            "@type": "ListItem",
            "item": "https://jassmin.ua/catalog/women",
            "name": "Жіночі парфуми",
            "position": 2,
          },
          {
            "@type": "ListItem",
            "item": "https://jassmin.ua/products/x",
            "name": "Coco",
            "position": 3,
          },
        ],
      }
    `);
  });
});

describe("parseOpeningHours", () => {
  it("reads Ukrainian and English day ranges with any dash", () => {
    expect(parseOpeningHours("Пн–Пт 10:00–20:00\nСб–Нд 11:00–18:00")).toEqual([
      "Mo-Fr 10:00-20:00",
      "Sa-Su 11:00-18:00",
    ]);
    expect(parseOpeningHours("Mon-Fri: 9.00 - 18.30\r\nSat 10:00—16:00")).toEqual([
      "Mo-Fr 09:00-18:30",
      "Sa 10:00-16:00",
    ]);
    expect(parseOpeningHours("Понеділок–П'ятниця 10:00–19:00")).toEqual(["Mo-Fr 10:00-19:00"]);
  });

  it("reads comma-separated days and every-day lines", () => {
    expect(parseOpeningHours("Пн, Ср, Пт 10:00–18:00")).toEqual(["Mo,We,Fr 10:00-18:00"]);
    expect(parseOpeningHours("Щодня 09:00–21:00")).toEqual(["Mo-Su 09:00-21:00"]);
    expect(parseOpeningHours("Daily 9:00–21:00")).toEqual(["Mo-Su 09:00-21:00"]);
  });

  it("leaves out lines it can't read", () => {
    expect(parseOpeningHours("Нд — вихідний\nПн–Пт 10:00–20:00\nСб 25:00–26:00")).toEqual([
      "Mo-Fr 10:00-20:00",
    ]);
    expect(parseOpeningHours("За домовленістю")).toEqual([]);
    expect(parseOpeningHours(null)).toEqual([]);
  });
});

const location: StoreLocationInput = {
  address: "вул. Хрещатик, 1, Київ, 01001",
  openingHours: "Пн–Пт 10:00–20:00\nСб–Нд 11:00–18:00",
  streetAddress: "вул. Хрещатик, 1",
  addressLocality: "Київ",
  postalCode: "01001",
  latitude: 50.4501,
  longitude: 30.5234,
  directionsUrl: "https://www.google.com/maps/search/?api=1&query=x",
};

const contacts = {
  phone: "+380 44 123 45 67",
  email: "hello@jassmin.ua",
  socialLinks: [
    { platform: "instagram" as const, url: "https://instagram.com/jassmin" },
    { platform: "telegram" as const, url: "https://t.me/jassmin" },
  ],
};

describe("storeGraphLd", () => {
  it("describes the shop as a PerfumeStore and the WebSite", () => {
    expect(
      storeGraphLd({ origin: ORIGIN, locale: "uk", location, contacts, image: "/hero.jpg" }),
    ).toMatchInlineSnapshot(`
      {
        "@context": "https://schema.org",
        "@graph": [
          {
            "@id": "https://jassmin.ua/#store",
            "@type": "PerfumeStore",
            "address": {
              "@type": "PostalAddress",
              "addressCountry": "UA",
              "addressLocality": "Київ",
              "postalCode": "01001",
              "streetAddress": "вул. Хрещатик, 1",
            },
            "email": "hello@jassmin.ua",
            "geo": {
              "@type": "GeoCoordinates",
              "latitude": 50.4501,
              "longitude": 30.5234,
            },
            "hasMap": "https://www.google.com/maps/search/?api=1&query=x",
            "image": "https://jassmin.ua/hero.jpg",
            "name": "Jassmin",
            "openingHours": [
              "Mo-Fr 10:00-20:00",
              "Sa-Su 11:00-18:00",
            ],
            "sameAs": [
              "https://instagram.com/jassmin",
              "https://t.me/jassmin",
            ],
            "telephone": "+380 44 123 45 67",
            "url": "https://jassmin.ua/",
          },
          {
            "@id": "https://jassmin.ua/#website",
            "@type": "WebSite",
            "inLanguage": "uk",
            "name": "Jassmin",
            "publisher": {
              "@id": "https://jassmin.ua/#store",
            },
            "url": "https://jassmin.ua/",
          },
        ],
      }
    `);
  });

  it("falls back to the one-line address and leaves out what isn't set", () => {
    const [store] = storeGraphLd({
      origin: ORIGIN,
      locale: "en",
      location: {
        ...location,
        openingHours: "by appointment",
        streetAddress: null,
        addressLocality: "Kyiv",
        postalCode: "01001",
        latitude: 50.45,
        longitude: null,
        directionsUrl: null,
      },
      contacts: { ...contacts, socialLinks: [] },
      image: null,
    })["@graph"];

    expect(store.address).toEqual({
      "@type": "PostalAddress",
      streetAddress: "вул. Хрещатик, 1, Київ, 01001",
      addressCountry: "UA",
    });
    for (const key of ["geo", "openingHours", "hasMap", "sameAs", "image"]) {
      expect(store).not.toHaveProperty(key);
    }
  });

  it("leaves out coordinates out of range", () => {
    const [store] = storeGraphLd({
      origin: ORIGIN,
      locale: "uk",
      location: { ...location, latitude: 120 },
      contacts,
      image: null,
    })["@graph"];

    expect(store).not.toHaveProperty("geo");
  });
});

describe("truncateWords", () => {
  it("cuts on a word boundary within the limit", () => {
    expect(truncateWords("Short title", 110)).toBe("Short title");
    const cut = truncateWords("one two three four", 12);
    expect(cut).toBe("one two…");
    expect(cut.length).toBeLessThanOrEqual(12);
  });
});

const post = {
  title: "Як обрати парфум",
  locale: "uk" as const,
  authorName: "Команда Jassmin",
  coverImage: {
    url: "https://cms.jassmin.ua/uploads/cover.jpg",
    alt: "",
    width: 1200,
    height: 800,
    srcSet: null,
  },
  publishedAt: "2026-10-22T19:06:58.498Z",
  updatedAt: "2026-10-23T08:00:00.000Z",
  seo: {
    title: "Як обрати парфум",
    description: "Верхні, серцеві та базові ноти.",
    image: null,
    canonicalUrl: "https://jassmin.ua/blog/how-to-choose",
  },
};

describe("blogPostingLd", () => {
  it("builds a BlogPosting with dates, author and language", () => {
    expect(
      blogPostingLd({ origin: ORIGIN, post, url: post.seo.canonicalUrl }),
    ).toMatchInlineSnapshot(`
        {
          "@context": "https://schema.org",
          "@type": "BlogPosting",
          "author": {
            "@type": "Person",
            "name": "Команда Jassmin",
          },
          "dateModified": "2026-10-23T08:00:00.000Z",
          "datePublished": "2026-10-22T19:06:58.498Z",
          "description": "Верхні, серцеві та базові ноти.",
          "headline": "Як обрати парфум",
          "image": "https://cms.jassmin.ua/uploads/cover.jpg",
          "inLanguage": "uk",
          "mainEntityOfPage": "https://jassmin.ua/blog/how-to-choose",
          "publisher": {
            "@type": "Organization",
            "name": "Jassmin",
            "url": "https://jassmin.ua/",
          },
        }
      `);
  });

  it("credits the shop without an author and keeps headlines short", () => {
    const ld = blogPostingLd({
      origin: ORIGIN,
      post: { ...post, authorName: null, coverImage: null, title: "Ноти ".repeat(40) },
      url: post.seo.canonicalUrl,
    });

    expect(ld.author).toEqual({ "@type": "Organization", name: "Jassmin", url: `${ORIGIN}/` });
    expect(ld.headline.length).toBeLessThanOrEqual(110);
    expect(ld).not.toHaveProperty("image");
  });
});
