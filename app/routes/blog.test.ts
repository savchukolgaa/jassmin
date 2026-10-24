import { afterEach, describe, expect, it, vi } from "vitest";
import { CmsError } from "~/.server/cms/errors";
import type { BlogPostSummary, Paginated } from "~/lib/cms";

const content = vi.hoisted(() => ({ listBlogPosts: vi.fn() }));
vi.mock("~/.server/cms/content", () => content);

const { headers, loader, meta } = await import("./blog");

type LoaderArgs = Parameters<typeof loader>[0];
type MetaArgs = Parameters<typeof meta>[0];

// `meta` reads the locale from the root match; the assertions are in English.
const EN = [{ id: "root", loaderData: { locale: "en" } }];
type HeadersArgs = Parameters<typeof headers>[0];

function summary(slug: string, publishedAt: string): BlogPostSummary {
  return {
    locale: "uk",
    slug,
    title: slug,
    excerpt: null,
    coverImage: null,
    authorName: null,
    publishedAt,
  };
}

function page(
  items: BlogPostSummary[],
  meta: Partial<Paginated<BlogPostSummary>> = {},
): Paginated<BlogPostSummary> {
  return { items, page: 1, pageSize: 12, pageCount: 1, total: items.length, ...meta };
}

function load(url: string, init?: RequestInit) {
  return loader({ request: new Request(url, init), params: {} } as unknown as LoaderArgs);
}

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("blog loader", () => {
  it("asks for the posts in the visitor's locale", async () => {
    content.listBlogPosts.mockResolvedValue(page([]));

    await load("http://localhost/blog", { headers: { "Accept-Language": "en-US,en;q=0.9" } });

    expect(content.listBlogPosts).toHaveBeenCalledExactlyOnceWith({
      page: 1,
      pageSize: 12,
      locale: "en",
    });
  });

  it("returns the posts in the order the CMS gives them (newest first)", async () => {
    content.listBlogPosts.mockResolvedValue(
      page([
        summary("newer", "2026-10-22T10:00:00.000Z"),
        summary("older", "2026-10-01T10:00:00.000Z"),
      ]),
    );

    const result = await load("http://localhost/blog");

    expect(content.listBlogPosts).toHaveBeenCalledExactlyOnceWith({
      page: 1,
      pageSize: 12,
      locale: "uk",
    });
    expect(result.data.posts.map((post) => post.slug)).toEqual(["newer", "older"]);
    expect(result.data.posts[0]?.publishedLabel.replace(/\s/gu, " ")).toBe("22 жовтня 2026 р.");
    expect(result.data.canonicalUrl).toBe("http://localhost/blog");
  });

  it("asks for the requested page and falls back to page 1 for bad values", async () => {
    content.listBlogPosts.mockResolvedValue(
      page([summary("a", "2026-10-22T10:00:00.000Z")], { page: 2, pageCount: 2, total: 13 }),
    );

    const result = await load("http://localhost/blog?page=2");
    expect(content.listBlogPosts).toHaveBeenLastCalledWith({ page: 2, pageSize: 12, locale: "uk" });
    expect(result.data.canonicalUrl).toBe("http://localhost/blog?page=2");

    content.listBlogPosts.mockResolvedValue(page([]));
    await load("http://localhost/blog?page=abc");
    expect(content.listBlogPosts).toHaveBeenLastCalledWith({ page: 1, pageSize: 12, locale: "uk" });
  });

  it("answers 404 for a page past the end", async () => {
    content.listBlogPosts.mockResolvedValue(page([], { page: 5, pageCount: 1, total: 2 }));

    await expect(load("http://localhost/blog?page=5")).rejects.toMatchObject({
      init: { status: 404 },
    });
  });

  it("shows an empty first page when there are no posts", async () => {
    content.listBlogPosts.mockResolvedValue(page([], { pageCount: 0, total: 0 }));

    const result = await load("http://localhost/blog");

    expect(result.data.posts).toEqual([]);
  });

  it("turns a CMS outage into a 503", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    content.listBlogPosts.mockRejectedValue(new CmsError("timeout", "Strapi timed out"));

    await expect(load("http://localhost/blog")).rejects.toMatchObject({ init: { status: 503 } });
  });

  it("lets shared caches store pages only for visitors without a session", async () => {
    content.listBlogPosts.mockResolvedValue(page([]));

    const anonymous = await load("http://localhost/blog");
    const withSession = await load("http://localhost/blog", {
      headers: { Cookie: "__jassmin_session=abc" },
    });

    const anonymousHeaders = new Headers(anonymous.init?.headers);
    expect(anonymousHeaders.get("Cache-Control")).toMatch(/^public, max-age=60/);
    expect(anonymousHeaders.get("Vary")).toBe("Cookie, Accept-Language");
    expect(new Headers(withSession.init?.headers).get("Cache-Control")).toBe("private, no-cache");
  });
});

describe("blog headers", () => {
  it("doesn't cache error responses", () => {
    const result = headers({ loaderHeaders: new Headers() } as unknown as HeadersArgs);
    expect(new Headers(result).get("Cache-Control")).toBe("no-store");
  });
});

describe("blog loader locale", () => {
  it("formats dates in the visitor's language", async () => {
    content.listBlogPosts.mockResolvedValue(page([summary("a", "2026-10-22T10:00:00.000Z")]));

    const result = await load("http://localhost/blog", { headers: { "Accept-Language": "en" } });

    expect(result.data.posts[0]?.publishedLabel).toBe("22 October 2026");
  });
});

describe("blog meta", () => {
  it("numbers later pages and sets the canonical URL", () => {
    const tags = meta({
      matches: EN,
      loaderData: {
        posts: [],
        page: 2,
        pageCount: 2,
        total: 13,
        canonicalUrl: "http://x/blog?page=2",
      },
    } as unknown as MetaArgs);

    expect(tags).toContainEqual({ title: "Blog — Page 2 — Jassmin" });
    expect(tags).toContainEqual({
      tagName: "link",
      rel: "canonical",
      href: "http://x/blog?page=2",
    });
  });

  it("has a title without loader data", () => {
    expect(meta({ loaderData: undefined, matches: EN } as unknown as MetaArgs)).toContainEqual({
      title: "Blog — Jassmin",
    });
  });
});
