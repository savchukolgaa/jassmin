import { afterEach, describe, expect, it, vi } from "vitest";
import blogPostBySlug from "./__fixtures__/blog-post-by-slug.json";
import blogPosts from "./__fixtures__/blog-posts.json";
import blogPostsEmpty from "./__fixtures__/blog-posts-empty.json";
import homePage from "./__fixtures__/home-page.json";
import siteSetting from "./__fixtures__/site-setting.json";
import {
  getBlogPostBySlug,
  getHomePage,
  getSiteSettings,
  listBlogPosts,
  toBlogPost,
  toImage,
  toSiteSettings,
} from "./content";
import { blogPostEntry, collectionResponse, singleResponse, siteSettingEntry } from "./schemas";

const BASE_URL = "http://cms.test";

vi.mock("../env", () => ({
  getEnv: () => ({ STRAPI_URL: "http://cms.test", STRAPI_API_TOKEN: "test-token" }),
}));

function respondWith(body: unknown) {
  const fetchMock = vi.fn<typeof fetch>(async () => Response.json(body));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("toImage", () => {
  it("resolves relative upload URLs against the CMS origin", () => {
    expect(
      toImage({ url: "/uploads/a.jpg", alternativeText: "A", width: 10, height: 5 }, BASE_URL),
    ).toEqual({ url: "http://cms.test/uploads/a.jpg", alt: "A", width: 10, height: 5 });
  });

  it("keeps absolute URLs from other upload providers", () => {
    const image = toImage({ url: "https://cdn.example.com/a.jpg" }, BASE_URL);

    expect(image).toEqual({
      url: "https://cdn.example.com/a.jpg",
      alt: "",
      width: null,
      height: null,
    });
  });

  it("maps a missing image to null", () => {
    expect(toImage(null, BASE_URL)).toBeNull();
    expect(toImage(undefined, BASE_URL)).toBeNull();
  });
});

describe("mappers", () => {
  it("map site settings and default missing social links to an empty list", () => {
    const { data } = singleResponse(siteSettingEntry).parse(siteSetting);

    expect(toSiteSettings(data).socialLinks).toEqual([
      { platform: "instagram", url: "https://www.instagram.com/jassmin" },
      { platform: "telegram", url: "https://t.me/jassmin" },
    ]);
    expect(toSiteSettings({ ...data, socialLinks: null }).socialLinks).toEqual([]);
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

    expect(page.hero).toEqual({
      headline: "Order 3 Testers only for 499₴",
      ctaLabel: "Choose your testers",
      ctaHref: "/catalog",
      image: {
        url: `http://cms.test${homePage.data.hero.image.url}`,
        alt: "Jassmin perfume testers",
        width: 1200,
        height: 800,
      },
    });
    expect(page.about.title).toBe("About Jassmin");
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
      authorName: "Jassmin team",
      seo: { metaTitle: expect.any(String), metaDescription: expect.any(String) },
    });
    expect(post?.content).toContain("## Start with the notes");
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
