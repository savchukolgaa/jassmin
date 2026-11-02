import { afterEach, describe, expect, it, vi } from "vitest";
import blogPostBySlugEn from "./__fixtures__/blog-post-by-slug.en.json";
import blogPostBySlug from "./__fixtures__/blog-post-by-slug.json";
import blogPostsEn from "./__fixtures__/blog-posts.en.json";
import blogPosts from "./__fixtures__/blog-posts.json";
import blogPostsEmpty from "./__fixtures__/blog-posts-empty.json";
import homePageEn from "./__fixtures__/home-page.en.json";
import homePage from "./__fixtures__/home-page.json";
import offersEn from "./__fixtures__/offers.en.json";
import offers from "./__fixtures__/offers.json";
import offersEmpty from "./__fixtures__/offers-empty.json";
import siteSettingEn from "./__fixtures__/site-setting.en.json";
import siteSetting from "./__fixtures__/site-setting.json";
import {
  compareOffers,
  getBlogPostBySlug,
  getHomePage,
  getSiteSettings,
  isOfferActive,
  listActiveOffers,
  listBlogPosts,
  listBlogPostsForSitemap,
  pickImage,
  toBlogPost,
  toHomePage,
  toImage,
  toOffer,
  toSiteSettings,
} from "./content";
import { CmsError } from "./errors";
import {
  blogPostEntry,
  collectionResponse,
  homePageEntry,
  offerEntry,
  singleResponse,
  siteSettingEntry,
} from "./schemas";

const BASE_URL = "http://cms.test";

vi.mock("../env", () => ({
  getEnv: () => ({ STRAPI_URL: "http://cms.test", STRAPI_API_TOKEN: "test-token" }),
}));

function respondWith(body: unknown) {
  const fetchMock = vi.fn<typeof fetch>(async () => Response.json(body));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const NOT_FOUND = {
  data: null,
  error: { status: 404, name: "NotFoundError", message: "Not Found" },
};

/**
 * Answers by the request's `locale` param: `bodies[locale]`, or Strapi's 404 for a locale
 * without one (`404`), so tests can leave a translation out.
 */
function respondByLocale(bodies: Partial<Record<string, unknown>>) {
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const locale = new URL(String(input)).searchParams.get("locale") ?? "";
    const body = bodies[locale];
    return body === undefined ? Response.json(NOT_FOUND, { status: 404 }) : Response.json(body);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function localesRequested(fetchMock: ReturnType<typeof respondByLocale>) {
  return fetchMock.mock.calls.map(([input]) => new URL(String(input)).searchParams.get("locale"));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("toImage", () => {
  it("resolves relative upload URLs against the CMS origin", () => {
    expect(
      toImage({ url: "/uploads/a.jpg", alternativeText: "A", width: 10, height: 5 }, BASE_URL),
    ).toEqual({
      url: "http://cms.test/uploads/a.jpg",
      alt: "A",
      width: 10,
      height: 5,
      srcSet: "http://cms.test/uploads/a.jpg 10w",
    });
  });

  it("builds a srcset from the resized formats and the original, smallest first", () => {
    const image = toImage(
      {
        url: "/uploads/a.jpg",
        width: 1200,
        height: 800,
        formats: {
          medium: { url: "/uploads/medium_a.jpg", width: 750, height: 500 },
          small: { url: "/uploads/small_a.jpg", width: 500, height: 333 },
        },
      },
      BASE_URL,
    );

    expect(image?.srcSet).toBe(
      "http://cms.test/uploads/small_a.jpg 500w, http://cms.test/uploads/medium_a.jpg 750w, http://cms.test/uploads/a.jpg 1200w",
    );
  });

  it("keeps absolute URLs from other upload providers", () => {
    const image = toImage({ url: "https://cdn.example.com/a.jpg" }, BASE_URL);

    expect(image).toEqual({
      url: "https://cdn.example.com/a.jpg",
      alt: "",
      width: null,
      height: null,
      srcSet: null,
    });
  });

  it("maps a missing image to null", () => {
    expect(toImage(null, BASE_URL)).toBeNull();
    expect(toImage(undefined, BASE_URL)).toBeNull();
  });
});

describe("pickImage", () => {
  const shared = { url: "/uploads/shared.jpg", alternativeText: "Shared file", width: 10 };
  const localized = { url: "/uploads/uk.jpg", alternativeText: "Ukrainian file", width: 20 };

  it("shows the locale's override when it is set", () => {
    expect(pickImage({ shared, localized, alt: null }, BASE_URL)).toMatchObject({
      url: "http://cms.test/uploads/uk.jpg",
      alt: "Ukrainian file",
      width: 20,
    });
  });

  it("falls back to the shared image without an override", () => {
    expect(pickImage({ shared, localized: null, alt: undefined }, BASE_URL)).toMatchObject({
      url: "http://cms.test/uploads/shared.jpg",
      alt: "Shared file",
    });
  });

  it("is null when neither image is set, even with alt text", () => {
    expect(pickImage({ shared: null, localized: undefined, alt: "Опис" }, BASE_URL)).toBeNull();
  });

  it("describes a shared or an override image with the entry's alt text", () => {
    expect(pickImage({ shared, localized: null, alt: " Опис " }, BASE_URL)?.alt).toBe("Опис");
    expect(pickImage({ shared, localized, alt: "Опис" }, BASE_URL)?.alt).toBe("Опис");
  });

  it("uses the file's alternative text for a blank alt, else an empty one", () => {
    expect(pickImage({ shared, localized: null, alt: "  " }, BASE_URL)?.alt).toBe("Shared file");
    expect(pickImage({ shared: { url: "/a.jpg" }, localized: null, alt: "" }, BASE_URL)?.alt).toBe(
      "",
    );
  });
});

describe("mappers", () => {
  it("take the locale Strapi served, else the requested one", () => {
    const { data } = singleResponse(siteSettingEntry).parse(siteSettingEn);

    expect(toSiteSettings(data, "uk").locale).toBe("en");
    expect(toSiteSettings({ ...data, locale: undefined }, "en").locale).toBe("en");
    expect(toSiteSettings({ ...data, locale: "de" }).locale).toBe("uk");
  });

  it("map site settings and default missing social links to an empty list", () => {
    const { data } = singleResponse(siteSettingEntry).parse(siteSetting);

    expect(toSiteSettings(data).socialLinks).toEqual([
      { platform: "instagram", url: "https://www.instagram.com/jassmin" },
      { platform: "telegram", url: "https://t.me/jassmin" },
    ]);
    expect(toSiteSettings({ ...data, socialLinks: null }).socialLinks).toEqual([]);
  });

  it("clean, filter and order social links (#101)", () => {
    const { data } = singleResponse(siteSettingEntry).parse(siteSetting);
    const socialLinks = [
      { platform: "telegram" as const, url: "https://t.me/jassmin" },
      { platform: "facebook" as const, url: "http://facebook.com/jassmin" },
      { platform: "instagram" as const, url: "https://www.instagram.com/jassminperfume?xtok=abc" },
    ];

    expect(toSiteSettings({ ...data, socialLinks }).socialLinks).toEqual([
      { platform: "instagram", url: "https://www.instagram.com/jassminperfume" },
      { platform: "telegram", url: "https://t.me/jassmin" },
    ]);
  });

  it("map the data controller's legal name, treating a blank one as missing", () => {
    const { data } = singleResponse(siteSettingEntry).parse(siteSetting);

    expect(toSiteSettings(data).legalName).toBeNull();
    expect(toSiteSettings({ ...data, legalName: " Іваненко Марія " }).legalName).toBe(
      "Іваненко Марія",
    );
    expect(toSiteSettings({ ...data, legalName: "  " }).legalName).toBeNull();
    expect(toSiteSettings({ ...data, legalName: undefined }).legalName).toBeNull();
  });

  it("map a post without cover image, author or SEO to nulls", () => {
    const [entry] = collectionResponse(blogPostEntry).parse(blogPostBySlug).data;
    if (!entry) throw new Error("fixture has no post");

    const post = toBlogPost(
      {
        ...entry,
        coverImage: null,
        coverImageLocalized: null,
        authorName: null,
        excerpt: null,
        seo: null,
      },
      BASE_URL,
    );

    expect(post).toMatchObject({ coverImage: null, authorName: null, excerpt: null, seo: null });
  });

  it("maps a post's last edit time, or null without one", () => {
    const [entry] = collectionResponse(blogPostEntry).parse(blogPostBySlug).data;
    if (!entry) throw new Error("fixture has no post");

    expect(toBlogPost(entry, BASE_URL).updatedAt).toBe("2026-10-24T11:46:35.374Z");
    expect(toBlogPost({ ...entry, updatedAt: null }, BASE_URL).updatedAt).toBeNull();
  });
});

describe("getHomePage", () => {
  it("returns the home page DTO with the shared hero image and the locale's alt", async () => {
    const fetchMock = respondWith(homePage);

    const page = await getHomePage();

    expect(page.locale).toBe("uk");
    expect(page.hero).toEqual({
      headline: "Замовте 3 тестери всього за 499₴",
      ctaLabel: "Замовити",
      ctaHref: "/popular",
      image: {
        url: `http://cms.test${homePage.data.heroImage.url}`,
        alt: "Тестери парфумів Jassmin",
        width: 1200,
        height: 800,
        srcSet: [
          "http://cms.test/uploads/thumbnail_hero_86b09bc538.jpg 234w",
          "http://cms.test/uploads/small_hero_86b09bc538.jpg 500w",
          "http://cms.test/uploads/medium_hero_86b09bc538.jpg 750w",
          "http://cms.test/uploads/large_hero_86b09bc538.jpg 1000w",
          "http://cms.test/uploads/hero_86b09bc538.jpg 1200w",
        ].join(", "),
      },
      eyebrow: "Тестерний набір",
      subtitle: expect.stringContaining("499₴"),
      secondaryCta: { label: "Усі парфуми", href: "/catalog/women" },
    });
    expect(page.about.title).toBe("Про Jassmin");
    expect(page.about.image).toMatchObject({ alt: "Флакони парфумів" });
    expect(page.location.address).toContain("Хрещатик");
    expect(page).not.toHaveProperty("documentId");

    const params = new URL(String(fetchMock.mock.calls[0]?.[0])).searchParams;
    expect(params.get("populate[heroImage]")).toBe("true");
    expect(params.get("populate[aboutImage]")).toBe("true");
    expect(params.get("populate[hero][populate][0]")).toBe("imageLocalized");
    expect(params.get("populate[about][populate][0]")).toBe("imageLocalized");
  });
});

describe("getSiteSettings", () => {
  it("returns contact details and social links", async () => {
    respondWith(siteSetting);

    await expect(getSiteSettings()).resolves.toMatchObject({
      phone: "+380 44 123 45 67",
      email: "hello@jassmin.ua",
    });
  });
});

describe("listBlogPostsForSitemap", () => {
  const entry = (documentId: string, slug: string, updatedAt: string) => ({
    documentId,
    slug,
    updatedAt,
  });
  const page = (data: unknown[], pageNumber: number, pageCount: number) => ({
    data,
    meta: { pagination: { page: pageNumber, pageSize: 50, pageCount, total: 51 } },
  });

  /** Answers by `locale` and `pagination[page]` from `pages[locale][page - 1]`. */
  function respondByLocaleAndPage(pages: Record<string, unknown[]>) {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const params = new URL(String(input)).searchParams;
      const index = Number(params.get("pagination[page]")) - 1;
      return Response.json(pages[params.get("locale") ?? ""]?.[index]);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("groups each post's slugs by locale, with its latest updatedAt", async () => {
    respondByLocaleAndPage({
      uk: [
        page([entry("a", "yak-obraty", "2026-10-01T10:00:00.000Z")], 1, 2),
        page([entry("b", "tilky-ukrainskoiu", "2026-10-02T10:00:00+03:00")], 2, 2),
      ],
      en: [page([entry("a", "how-to-choose", "2026-10-05T10:00:00.000Z")], 1, 1)],
    });

    expect(await listBlogPostsForSitemap()).toEqual([
      {
        documentId: "a",
        slugs: { uk: "yak-obraty", en: "how-to-choose" },
        updatedAt: "2026-10-05T10:00:00.000Z",
      },
      {
        documentId: "b",
        slugs: { uk: "tilky-ukrainskoiu" },
        updatedAt: "2026-10-02T07:00:00.000Z",
      },
    ]);
  });

  it("requests only the sitemap fields, 50 per page, in each locale", async () => {
    const fetchMock = respondByLocaleAndPage({
      uk: [page([], 1, 0)],
      en: [page([], 1, 0)],
    });

    expect(await listBlogPostsForSitemap()).toEqual([]);

    const urls = fetchMock.mock.calls.map(([input]) => new URL(String(input)));
    expect(urls.map((url) => url.searchParams.get("locale"))).toEqual(["uk", "en"]);
    const [first] = urls;
    expect(first?.pathname).toBe("/api/blog-posts");
    expect(first?.searchParams.get("status")).toBe("published");
    expect(first?.searchParams.get("fields[0]")).toBe("slug");
    expect(first?.searchParams.get("fields[1]")).toBe("updatedAt");
    expect(first?.searchParams.get("pagination[pageSize]")).toBe("50");
  });

  it("throws a CmsError when Strapi is down", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    await expect(listBlogPostsForSitemap()).rejects.toBeInstanceOf(CmsError);
  });
});

describe("listBlogPosts", () => {
  it("returns post summaries with pagination meta", async () => {
    respondWith(blogPosts);

    const result = await listBlogPosts({ page: 1, pageSize: 12 });

    expect(result).toMatchObject({ page: 1, pageSize: 12, pageCount: 1, total: 2 });
    expect(result.items.map((post) => post.slug)).toEqual([
      "fragrance-families-explained",
      "how-to-choose-a-perfume",
    ]);
    expect(result.items[0]?.coverImage?.url).toMatch(/^http:\/\/cms\.test\/uploads\//);
    expect(result.items[0]).not.toHaveProperty("content");
  });

  it("requests published posts newest first with the given page", async () => {
    const fetchMock = respondWith(blogPostsEmpty);

    await listBlogPosts({ page: 3, pageSize: 5 });

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/api/blog-posts");
    expect(url.searchParams.get("status")).toBe("published");
    expect(url.searchParams.get("sort[0]")).toBe("publishedAt:desc");
    expect(url.searchParams.get("pagination[page]")).toBe("3");
    expect(url.searchParams.get("pagination[pageSize]")).toBe("5");
    expect(url.searchParams.get("populate[0]")).toBe("coverImage");
    expect(url.searchParams.get("populate[1]")).toBe("coverImageLocalized");
  });

  it("defaults to the first page of 12", async () => {
    const fetchMock = respondWith(blogPostsEmpty);

    await listBlogPosts();

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.searchParams.get("pagination[page]")).toBe("1");
    expect(url.searchParams.get("pagination[pageSize]")).toBe("12");
  });

  it.each([{ page: 0 }, { page: 1.5 }, { pageSize: 0 }, { pageSize: 500 }])(
    "rejects invalid pagination %o without calling Strapi",
    async (input) => {
      const fetchMock = respondWith(blogPostsEmpty);

      await expect(listBlogPosts(input)).rejects.toThrow(RangeError);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});

describe("getBlogPostBySlug", () => {
  it("returns the full post with content and SEO", async () => {
    respondWith(blogPostBySlug);

    const post = await getBlogPostBySlug("how-to-choose-a-perfume");

    expect(post).toMatchObject({
      slug: "how-to-choose-a-perfume",
      locale: "uk",
      authorName: "Команда Jassmin",
      seo: { metaTitle: expect.any(String), metaDescription: expect.any(String) },
    });
    expect(post?.content).toContain("## Почніть із нот");
    expect(post?.publishedAt).toBe(new Date(post?.publishedAt ?? "").toISOString());
  });

  it("filters by the exact slug and only asks for published posts", async () => {
    const fetchMock = respondWith(blogPostsEmpty);

    await getBlogPostBySlug("a&b c");

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.searchParams.get("filters[slug][$eq]")).toBe("a&b c");
    expect(url.searchParams.get("status")).toBe("published");
    expect(url.searchParams.get("populate[seo][populate][0]")).toBe("ogImage");
    expect(url.searchParams.get("populate[coverImage]")).toBe("true");
    expect(url.searchParams.get("populate[coverImageLocalized]")).toBe("true");
  });

  it("returns null when no published post has the slug (e.g. a draft)", async () => {
    respondWith(blogPostsEmpty);

    await expect(getBlogPostBySlug("summer-scents-draft")).resolves.toBeNull();
  });

  it("returns null for an empty slug without calling Strapi", async () => {
    const fetchMock = respondWith(blogPostsEmpty);

    await expect(getBlogPostBySlug("  ")).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("locales and fallback to Ukrainian", () => {
  it("asks Strapi for Ukrainian by default", async () => {
    const fetchMock = respondByLocale({ uk: homePage });

    await getHomePage();

    expect(localesRequested(fetchMock)).toEqual(["uk"]);
  });

  it("returns the English home page and site settings when they exist, in one request each", async () => {
    const homeMock = respondByLocale({ uk: homePage, en: homePageEn });
    const page = await getHomePage("en");

    expect(localesRequested(homeMock)).toEqual(["en"]);
    expect(page).toMatchObject({
      locale: "en",
      hero: { headline: "Order 3 Testers only for 499₴", ctaLabel: "Order Now" },
      about: { title: "About Jassmin" },
    });

    const settingsMock = respondByLocale({ uk: siteSetting, en: siteSettingEn });
    await expect(getSiteSettings("en")).resolves.toMatchObject({
      locale: "en",
      customerServiceHours: "Mon–Fri 9:00–18:00",
    });
    expect(localesRequested(settingsMock)).toEqual(["en"]);
  });

  it("falls back to the Ukrainian single types when the English ones are missing (404)", async () => {
    const homeMock = respondByLocale({ uk: homePage });
    await expect(getHomePage("en")).resolves.toMatchObject({
      locale: "uk",
      hero: { headline: "Замовте 3 тестери всього за 499₴" },
    });
    expect(localesRequested(homeMock)).toEqual(["en", "uk"]);

    const settingsMock = respondByLocale({ uk: siteSetting });
    await expect(getSiteSettings("en")).resolves.toMatchObject({
      locale: "uk",
      customerServiceHours: "Пн–Пт 9:00–18:00",
    });
    expect(localesRequested(settingsMock)).toEqual(["en", "uk"]);
  });

  it("never retries a Ukrainian request, and a missing Ukrainian single type is a CmsError", async () => {
    const fetchMock = respondByLocale({});

    const error: unknown = await getHomePage("uk").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CmsError);
    expect(error).toMatchObject({ kind: "http", status: 404 });
    expect(localesRequested(fetchMock)).toEqual(["uk"]);
  });

  it("rethrows the 404 when neither the English nor the Ukrainian version exists", async () => {
    respondByLocale({});

    await expect(getSiteSettings("en")).rejects.toMatchObject({ kind: "http", status: 404 });
  });

  it("doesn't fall back when Strapi fails for another reason", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ error: { status: 500 } }, { status: 500 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getHomePage("en")).rejects.toMatchObject({ kind: "http", status: 500 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("returns the English post by slug when it exists", async () => {
    const fetchMock = respondByLocale({ uk: blogPostBySlug, en: blogPostBySlugEn });

    const post = await getBlogPostBySlug("how-to-choose-a-perfume", "en");

    expect(post).toMatchObject({ locale: "en", slug: "how-to-choose-a-perfume" });
    expect(post?.content).toContain("## Start with the notes");
    // The post, then its Ukrainian slug for the alternates.
    expect(localesRequested(fetchMock)).toEqual(["en", "uk"]);
  });

  it("falls back to the Ukrainian post with the same slug when it has no English version", async () => {
    const fetchMock = respondByLocale({ uk: blogPostBySlug, en: blogPostsEmpty });

    const post = await getBlogPostBySlug("how-to-choose-a-perfume", "en");

    expect(post).toMatchObject({ locale: "uk", slug: "how-to-choose-a-perfume" });
    expect(post?.alternates).toEqual({ uk: "how-to-choose-a-perfume" });
    expect(localesRequested(fetchMock)).toEqual(["en", "uk", "en"]);
  });

  it("returns the post's slug in each locale it's published in (#84)", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.searchParams.get("fields[0]") === "slug") {
        expect(url.searchParams.get("filters[documentId][$eq]")).toBeTruthy();
        return Response.json({ ...blogPostsEmpty, data: [{ slug: "yak-obraty-parfum" }] });
      }
      return Response.json(blogPostBySlugEn);
    });
    vi.stubGlobal("fetch", fetchMock);

    const post = await getBlogPostBySlug("how-to-choose-a-perfume", "en");

    expect(post?.alternates).toEqual({ en: "how-to-choose-a-perfume", uk: "yak-obraty-parfum" });
  });

  it("returns null for a slug that exists in no locale", async () => {
    const fetchMock = respondByLocale({ uk: blogPostsEmpty, en: blogPostsEmpty });

    await expect(getBlogPostBySlug("nope", "en")).resolves.toBeNull();
    expect(localesRequested(fetchMock)).toEqual(["en", "uk"]);
  });

  it("lists the Ukrainian posts with one request for the Ukrainian UI", async () => {
    const fetchMock = respondByLocale({ uk: blogPosts });

    const result = await listBlogPosts({ locale: "uk" });

    expect(localesRequested(fetchMock)).toEqual(["uk"]);
    expect(result.items.map((post) => post.locale)).toEqual(["uk", "uk"]);
  });

  it("swaps in English translations by documentId and keeps Ukrainian-only posts", async () => {
    const fetchMock = respondByLocale({ uk: blogPosts, en: blogPostsEn });

    const result = await listBlogPosts({ page: 1, pageSize: 12, locale: "en" });

    expect(localesRequested(fetchMock)).toEqual(["uk", "en"]);
    expect(result.items.map(({ slug, locale, title }) => ({ slug, locale, title }))).toEqual([
      {
        slug: "fragrance-families-explained",
        locale: "uk",
        title: "Родини ароматів: коротко й зрозуміло",
      },
      {
        slug: "how-to-choose-a-perfume",
        locale: "en",
        title: "How to choose a perfume you won't get tired of",
      },
    ]);
    // Pages come from the Ukrainian posts, so the English page has the same pagination.
    expect(result).toMatchObject({ page: 1, pageSize: 12, pageCount: 1, total: 2 });

    const translations = new URL(String(fetchMock.mock.calls[1]?.[0])).searchParams;
    expect(translations.getAll("filters[documentId][$in][0]")).toEqual([
      blogPosts.data[0]?.documentId,
    ]);
    expect(translations.get("filters[documentId][$in][1]")).toBe(blogPosts.data[1]?.documentId);
    expect(translations.get("pagination[pageSize]")).toBe("2");
    expect(translations.get("status")).toBe("published");
  });

  it("skips the translation request for an empty page", async () => {
    const fetchMock = respondByLocale({ uk: blogPostsEmpty });

    await expect(listBlogPosts({ locale: "en" })).resolves.toMatchObject({ items: [] });
    expect(localesRequested(fetchMock)).toEqual(["uk"]);
  });
});

describe("toHomePage", () => {
  it("keeps the served locale on the DTO", () => {
    const { data } = singleResponse(homePageEntry).parse(homePageEn);

    expect(toHomePage(data, BASE_URL).locale).toBe("en");
  });

  it("maps the structured address and coordinates", () => {
    const { data } = singleResponse(homePageEntry).parse(homePage);

    expect(toHomePage(data, BASE_URL).location).toMatchObject({
      streetAddress: "вул. Хрещатик, 1",
      addressLocality: "Київ",
      postalCode: "01001",
      latitude: 50.4501,
      longitude: 30.5234,
    });
  });

  it("treats a missing, blank or invalid structured address as not set", () => {
    const parse = (location: Record<string, unknown>) => {
      const { data } = singleResponse(homePageEntry).parse({
        ...homePage,
        data: { ...homePage.data, location: { ...homePage.data.location, ...location } },
      });
      return toHomePage(data, BASE_URL).location;
    };

    expect(parse({ streetAddress: "  ", latitude: null, longitude: undefined })).toMatchObject({
      streetAddress: null,
      latitude: null,
      longitude: null,
    });
    expect(parse({ latitude: 91, longitude: "abc" })).toMatchObject({
      latitude: null,
      longitude: null,
    });
    expect(parse({ latitude: "50.45", longitude: "-30.5" })).toMatchObject({
      latitude: 50.45,
      longitude: -30.5,
    });
    const { data } = singleResponse(homePageEntry).parse(homePageEn);
    expect(toHomePage(data, BASE_URL).location).toMatchObject({
      streetAddress: null,
      addressLocality: null,
      postalCode: null,
      latitude: null,
      longitude: null,
    });
  });

  it("maps the optional hero fields and the about image", () => {
    const { data } = singleResponse(homePageEntry).parse(homePageEn);
    const page = toHomePage(data, BASE_URL);

    expect(page.hero).toMatchObject({
      eyebrow: "Tester set",
      subtitle: expect.stringContaining("499₴"),
      secondaryCta: { label: "See all perfumes", href: "/catalog/women" },
    });
    expect(page.about.image?.url).toMatch(/^http:\/\/cms\.test\/uploads\//);
  });

  it("treats blank or missing optional fields as not set", () => {
    const { data } = singleResponse(homePageEntry).parse(homePage);
    const page = toHomePage(
      {
        ...data,
        hero: {
          ...data.hero,
          eyebrow: "  ",
          subtitle: null,
          secondaryCtaLabel: "All perfumes",
          secondaryCtaHref: undefined,
        },
        aboutImage: null,
        about: { title: data.about.title, body: data.about.body },
      },
      BASE_URL,
    );

    expect(page.hero).toMatchObject({ eyebrow: null, subtitle: null, secondaryCta: null });
    expect(page.about.image).toBeNull();
  });

  it("shows a locale's own photo instead of the shared one, only in that locale (#80)", () => {
    const uk = singleResponse(homePageEntry).parse(homePage).data;
    const en = singleResponse(homePageEntry).parse(homePageEn).data;
    const banner = { url: "/uploads/banner_en.jpg", alternativeText: null, width: 800 };

    const english = toHomePage(
      { ...en, hero: { ...en.hero, imageLocalized: banner } },
      BASE_URL,
      "en",
    );
    const ukrainian = toHomePage(uk, BASE_URL);

    expect(english.hero.image).toMatchObject({
      url: "http://cms.test/uploads/banner_en.jpg",
      alt: "Jassmin perfume testers",
    });
    expect(ukrainian.hero.image?.url).toBe(`http://cms.test${uk.heroImage?.url}`);
    expect(toHomePage(en, BASE_URL).hero.image?.url).toBe(ukrainian.hero.image?.url);
  });
});

const NOW = new Date("2026-12-01T10:00:00.000Z");

function offerEntryFrom(index: number) {
  const entry = collectionResponse(offerEntry).parse(offers).data[index];
  if (!entry) {
    throw new Error(`offers.json has no entry ${index}`);
  }
  return entry;
}

describe("toOffer", () => {
  it("maps an offer with absolute image URLs and its products", () => {
    const offer = toOffer(offerEntryFrom(2), BASE_URL);

    expect(offer).toMatchObject({
      locale: "uk",
      slug: "tester-trio",
      kind: "discovery-set",
      title: "Тестерне тріо",
      priceNote: "3 × 10 мл — 499 ₴",
      ctaLabel: "Зібрати тріо",
      ctaUrl: "/catalog/women",
      sortOrder: 10,
      startsAt: null,
      endsAt: null,
    });
    expect(offer.image?.url).toMatch(/^http:\/\/cms\.test\/uploads\//);
    expect(offer.image?.srcSet).toContain("http://cms.test/uploads/small_");
    expect(offer.image?.alt).toBe("Тестери парфумів Jassmin");
    expect(offer.productIds).toEqual([
      "01a1652b-6e25-7c03-ae47-25b57131fb06",
      "01a1652b-6e25-7c51-bcf8-0d0dd7accc0a",
      "01a1652b-6e25-7c55-8003-478f2d6abfb1",
    ]);
  });

  it("normalises offset date-times to UTC", () => {
    const offer = toOffer(
      {
        ...offerEntryFrom(1),
        startsAt: "2026-12-06T00:00:00+02:00",
        endsAt: "2027-06-01T09:30:00+03:00",
      },
      BASE_URL,
    );

    expect(offer.startsAt).toBe("2026-12-05T22:00:00.000Z");
    expect(offer.endsAt).toBe("2027-06-01T06:30:00.000Z");
  });

  it("drops product ids that aren't UUIDs and repeats", () => {
    const offer = toOffer(
      {
        ...offerEntryFrom(1),
        products: [
          { publicId: "01A1652B-6E25-7C3F-9567-5F694E414A33" },
          { publicId: "not-a-uuid" },
          { publicId: "01a1652b-6e25-7c3f-9567-5f694e414a33" },
          { publicId: "' or 1=1 --" },
        ],
      },
      BASE_URL,
    );

    expect(offer.productIds).toEqual(["01a1652b-6e25-7c3f-9567-5f694e414a33"]);
  });

  it("turns blank and missing optional fields into null and a missing sortOrder into 0", () => {
    const offer = toOffer(
      {
        ...offerEntryFrom(0),
        summary: "  ",
        body: undefined,
        ctaLabel: "",
        sortOrder: null,
        products: null,
        image: null,
        imageLocalized: null,
      },
      BASE_URL,
    );

    expect(offer).toMatchObject({
      summary: null,
      body: null,
      ctaLabel: null,
      sortOrder: 0,
      productIds: [],
      image: null,
    });
  });
});

describe("offer and blog images (#80)", () => {
  const override = { url: "/uploads/uk_banner.jpg", alternativeText: "Банер" };

  it("shows an offer's per-language image over the shared one", () => {
    const entry = offerEntryFrom(2);

    expect(toOffer({ ...entry, imageLocalized: override }, BASE_URL).image).toMatchObject({
      url: "http://cms.test/uploads/uk_banner.jpg",
      alt: "Тестери парфумів Jassmin",
    });
    expect(toOffer(entry, BASE_URL).image?.url).toBe(`http://cms.test${entry.image?.url}`);
  });

  it("shows a post's per-language cover over the shared one", () => {
    const [entry] = collectionResponse(blogPostEntry).parse(blogPostBySlugEn).data;
    if (!entry) throw new Error("fixture has no post");

    expect(
      toBlogPost({ ...entry, coverImageLocalized: override }, BASE_URL).coverImage,
    ).toMatchObject({ url: "http://cms.test/uploads/uk_banner.jpg", alt: "Perfume bottles" });
    expect(toBlogPost(entry, BASE_URL).coverImage?.url).toBe(
      `http://cms.test${entry.coverImage?.url}`,
    );
  });
});

describe("isOfferActive", () => {
  const window = (startsAt: string | null, endsAt: string | null) => ({ startsAt, endsAt });

  it("treats a missing start as started and a missing end as never ending", () => {
    expect(isOfferActive(window(null, null), NOW)).toBe(true);
    expect(isOfferActive(window("2026-11-01T00:00:00.000Z", null), NOW)).toBe(true);
    expect(isOfferActive(window(null, "2027-01-01T00:00:00.000Z"), NOW)).toBe(true);
  });

  it("is active from startsAt (inclusive) until endsAt (exclusive)", () => {
    const start = "2026-12-01T10:00:00.000Z";
    const end = "2026-12-02T10:00:00.000Z";

    expect(isOfferActive(window(start, end), new Date(start))).toBe(true);
    expect(isOfferActive(window(start, end), new Date("2026-12-01T09:59:59.999Z"))).toBe(false);
    expect(isOfferActive(window(start, end), new Date("2026-12-02T09:59:59.999Z"))).toBe(true);
    expect(isOfferActive(window(start, end), new Date(end))).toBe(false);
  });

  it("is inactive before the start and after the end", () => {
    expect(isOfferActive(window("2026-12-24T00:00:00.000Z", null), NOW)).toBe(false);
    expect(isOfferActive(window(null, "2026-11-30T00:00:00.000Z"), NOW)).toBe(false);
  });

  it("compares instants, whatever offset they were written with", () => {
    // Midnight on 6 December in Kyiv (UTC+2) is 22:00 UTC on 5 December.
    const kyivMidnight = "2026-12-06T00:00:00+02:00";

    expect(isOfferActive(window(kyivMidnight, null), new Date("2026-12-05T21:59:59Z"))).toBe(false);
    expect(isOfferActive(window(kyivMidnight, null), new Date("2026-12-05T22:00:00Z"))).toBe(true);
    expect(isOfferActive(window(null, kyivMidnight), new Date("2026-12-05T22:00:00Z"))).toBe(false);
  });
});

describe("compareOffers", () => {
  const offer = (documentId: string, sortOrder: number, startsAt: string | null = null) => ({
    documentId,
    sortOrder,
    startsAt,
  });

  it("orders by sortOrder, then the latest start, then documentId", () => {
    const sorted = [
      offer("e", 5),
      offer("d", 0, null),
      offer("c", 0, "2026-11-01T00:00:00.000Z"),
      offer("b", 0, "2026-12-01T00:00:00.000Z"),
      offer("a", 5),
      offer("z", -1),
    ].sort(compareOffers);

    expect(sorted.map((o) => o.documentId)).toEqual(["z", "b", "c", "d", "a", "e"]);
  });
});

describe("listActiveOffers", () => {
  it("returns the active offers in editor order", async () => {
    respondWith(offers);

    const result = await listActiveOffers("uk", NOW);

    // PostgreSQL sorts NULL starts first in `startsAt:desc`; the app puts started offers first.
    expect(result.map((o) => o.slug)).toEqual([
      "winter-holidays",
      "free-delivery",
      "tester-trio",
      "gifts-by-budget",
      "welcome-offer",
    ]);
    expect(result.every((o) => o.locale === "uk")).toBe(true);
  });

  it("asks Strapi for published Ukrainian offers in the window around now", async () => {
    const fetchMock = respondWith(offersEmpty);

    await listActiveOffers("uk", NOW);

    expect(fetchMock).toHaveBeenCalledOnce();
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    const params = url.searchParams;
    expect(url.pathname).toBe("/api/offers");
    expect(params.get("status")).toBe("published");
    expect(params.get("locale")).toBe("uk");
    expect(params.get("filters[$and][0][$or][0][startsAt][$null]")).toBe("true");
    expect(params.get("filters[$and][0][$or][1][startsAt][$lte]")).toBe(NOW.toISOString());
    expect(params.get("filters[$and][1][$or][0][endsAt][$null]")).toBe("true");
    expect(params.get("filters[$and][1][$or][1][endsAt][$gt]")).toBe(NOW.toISOString());
    expect(params.get("sort[0]")).toBe("sortOrder:asc");
    expect(params.get("sort[1]")).toBe("startsAt:desc");
    expect(params.get("pagination[pageSize]")).toBe("50");
    expect(params.get("populate[image]")).toBe("true");
    expect(params.get("populate[imageLocalized]")).toBe("true");
    expect(params.get("populate[products]")).toBe("true");
  });

  it("drops offers Strapi returns outside the window, e.g. when clocks differ", async () => {
    respondWith(offers);

    // Winter holidays end on 8 January (22:00 UTC): a minute later only the rest remain.
    const result = await listActiveOffers("uk", new Date("2027-01-08T22:01:00.000Z"));

    expect(result.map((o) => o.slug)).not.toContain("winter-holidays");
    expect(result).toHaveLength(4);
  });

  it("re-sorts so the order doesn't depend on Strapi", async () => {
    respondWith({ ...offers, data: [...offers.data].reverse() });

    const result = await listActiveOffers("uk", NOW);

    expect(result[0]?.slug).toBe("winter-holidays");
    expect(result[1]?.slug).toBe("free-delivery");
  });

  it("swaps in English translations and keeps Ukrainian where one is missing", async () => {
    const fetchMock = respondByLocale({ uk: offers, en: offersEn });

    const result = await listActiveOffers("en", NOW);

    expect(localesRequested(fetchMock)).toEqual(["uk", "en"]);
    const translationQuery = new URL(String(fetchMock.mock.calls[1]?.[0])).searchParams;
    expect(translationQuery.get("filters[documentId][$in][0]")).toBe(offers.data[0]?.documentId);
    expect(result.map((o) => [o.slug, o.locale])).toEqual([
      ["winter-holidays", "en"],
      ["free-delivery", "en"],
      ["tester-trio", "en"],
      ["gifts-by-budget", "uk"],
      ["welcome-offer", "en"],
    ]);
    expect(result[2]?.ctaLabel).toBe("Build my trio");
  });

  it("doesn't ask for translations when no offer is active", async () => {
    const fetchMock = respondWith(offersEmpty);

    await expect(listActiveOffers("en", NOW)).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("throws a CmsError when Strapi is down", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    await expect(listActiveOffers("uk", NOW)).rejects.toBeInstanceOf(CmsError);
  });
});
