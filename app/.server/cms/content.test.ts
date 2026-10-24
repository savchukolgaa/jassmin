import { afterEach, describe, expect, it, vi } from "vitest";
import blogPostBySlugEn from "./__fixtures__/blog-post-by-slug.en.json";
import blogPostBySlug from "./__fixtures__/blog-post-by-slug.json";
import blogPostsEn from "./__fixtures__/blog-posts.en.json";
import blogPosts from "./__fixtures__/blog-posts.json";
import blogPostsEmpty from "./__fixtures__/blog-posts-empty.json";
import homePageEn from "./__fixtures__/home-page.en.json";
import homePage from "./__fixtures__/home-page.json";
import siteSettingEn from "./__fixtures__/site-setting.en.json";
import siteSetting from "./__fixtures__/site-setting.json";
import {
  getBlogPostBySlug,
  getHomePage,
  getSiteSettings,
  listBlogPosts,
  toBlogPost,
  toHomePage,
  toImage,
  toSiteSettings,
} from "./content";
import { CmsError } from "./errors";
import {
  blogPostEntry,
  collectionResponse,
  homePageEntry,
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
      { ...entry, coverImage: null, authorName: null, excerpt: null, seo: null },
      BASE_URL,
    );

    expect(post).toMatchObject({ coverImage: null, authorName: null, excerpt: null, seo: null });
  });
});

describe("getHomePage", () => {
  it("returns the home page DTO with an absolute hero image URL", async () => {
    respondWith(homePage);

    const page = await getHomePage();

    expect(page.locale).toBe("uk");
    expect(page.hero).toEqual({
      headline: "Замовте 3 тестери всього за 499₴",
      ctaLabel: "Замовити",
      ctaHref: "/popular",
      image: {
        url: `http://cms.test${homePage.data.hero.image.url}`,
        alt: "Jassmin perfume testers",
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
    });
    expect(page.about.title).toBe("Про Jassmin");
    expect(page.location.address).toContain("Хрещатик");
    expect(page).not.toHaveProperty("documentId");
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
    expect(localesRequested(fetchMock)).toEqual(["en"]);
  });

  it("falls back to the Ukrainian post with the same slug when it has no English version", async () => {
    const fetchMock = respondByLocale({ uk: blogPostBySlug, en: blogPostsEmpty });

    const post = await getBlogPostBySlug("how-to-choose-a-perfume", "en");

    expect(post).toMatchObject({ locale: "uk", slug: "how-to-choose-a-perfume" });
    expect(localesRequested(fetchMock)).toEqual(["en", "uk"]);
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
});
