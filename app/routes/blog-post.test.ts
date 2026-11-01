import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CmsError } from "~/.server/cms/errors";
import type { BlogPost } from "~/lib/cms";

const content = vi.hoisted(() => ({ getBlogPostBySlug: vi.fn() }));
vi.mock("~/.server/cms/content", () => content);

const { loader, meta } = await import("./blog-post");

type LoaderArgs = Parameters<typeof loader>[0];
type MetaArgs = Parameters<typeof meta>[0];

// `meta` reads the locale from the root match; the assertions are in English.
const EN = [{ id: "root", loaderData: { locale: "en", site: { url: "https://jassmin.ua" } } }];
const LOCATION = { pathname: "/blog/how-to-choose-a-perfume", search: "?utm_source=telegram" };

const CMS = "http://cms.test:1337";

const post: BlogPost = {
  locale: "uk",
  slug: "how-to-choose-a-perfume",
  title: "How to choose a perfume",
  excerpt: "Top, heart and base notes.",
  coverImage: {
    url: `${CMS}/uploads/cover.jpg`,
    alt: "Perfume bottles",
    width: 1200,
    height: 800,
    srcSet: null,
  },
  authorName: "Jassmin team",
  publishedAt: "2026-10-22T19:06:58.498Z",
  updatedAt: "2026-10-23T08:00:00.000Z",
  content:
    "## Start with the notes\n\n![Notes](/uploads/notes.jpg)\n\n<script>alert(1)</script><img src=x onerror=alert(1)>",
  seo: null,
};

function load(slug: string | undefined, headers?: HeadersInit) {
  return loader({
    request: new Request(`https://jassmin.ua/blog/${slug ?? ""}`, { headers }),
    params: { slug },
  } as unknown as LoaderArgs);
}

beforeAll(() => {
  vi.stubEnv("DATABASE_URL", "postgres://jassmin:jassmin@localhost:5432/jassmin");
  vi.stubEnv("SESSION_SECRET", "s".repeat(32));
  vi.stubEnv("STRAPI_URL", CMS);
});

afterAll(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("blog post loader", () => {
  it("asks for the post in the visitor's locale, at the same URL", async () => {
    content.getBlogPostBySlug.mockResolvedValue({ ...post, locale: "en" });

    const { data } = await load(post.slug, { "Accept-Language": "en" });

    expect(content.getBlogPostBySlug).toHaveBeenCalledExactlyOnceWith(post.slug, "en");
    expect(data.locale).toBe("en");
  });

  it("renders the published post with sanitized HTML and absolute image URLs", async () => {
    content.getBlogPostBySlug.mockResolvedValue(post);

    const { data } = await load(post.slug);

    expect(content.getBlogPostBySlug).toHaveBeenCalledExactlyOnceWith(post.slug, "uk");
    expect(data.contentHtml).toContain("<h2>Start with the notes</h2>");
    expect(data.contentHtml).toContain(`src="${CMS}/uploads/notes.jpg"`);
    expect(data.contentHtml).not.toMatch(/<script|onerror|src="x"/);
  });

  it("answers 404 for unknown slugs and drafts", async () => {
    // The CMS client only asks for published posts, so a draft's slug finds nothing.
    content.getBlogPostBySlug.mockResolvedValue(null);

    await expect(load("draft-post")).rejects.toMatchObject({ init: { status: 404 } });
  });

  it("answers 404 for malformed slugs without asking Strapi", async () => {
    await expect(load("<script>")).rejects.toMatchObject({ init: { status: 404 } });
    await expect(load(undefined)).rejects.toMatchObject({ init: { status: 404 } });
    expect(content.getBlogPostBySlug).not.toHaveBeenCalled();
  });

  it("turns a CMS outage into a 503", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    content.getBlogPostBySlug.mockRejectedValue(new CmsError("unreachable", "fetch failed"));

    await expect(load(post.slug)).rejects.toMatchObject({ init: { status: 503 } });
  });

  it("sends cache headers that vary on the session cookie", async () => {
    content.getBlogPostBySlug.mockResolvedValue(post);

    const result = await load(post.slug);

    expect(new Headers(result.init?.headers).get("Vary")).toBe("Cookie, Accept-Language");
  });
});

describe("blog post meta", () => {
  it("sets the title, description, Open Graph tags and canonical URL", async () => {
    content.getBlogPostBySlug.mockResolvedValue(post);
    const { data } = await load(post.slug);

    const tags = meta({ loaderData: data, matches: EN, location: LOCATION } as unknown as MetaArgs);

    expect(tags).toEqual(
      expect.arrayContaining([
        { title: "How to choose a perfume — Jassmin" },
        { name: "description", content: "Top, heart and base notes." },
        { property: "og:type", content: "article" },
        { property: "og:title", content: "How to choose a perfume — Jassmin" },
        { property: "og:url", content: "https://jassmin.ua/blog/how-to-choose-a-perfume" },
        { property: "og:image:alt", content: "How to choose a perfume" },
        { name: "twitter:card", content: "summary_large_image" },
        { property: "og:description", content: "Top, heart and base notes." },
        { property: "og:image", content: `${CMS}/uploads/cover.jpg` },
        { property: "article:published_time", content: "2026-10-22T19:06:58.498Z" },
        {
          tagName: "link",
          rel: "canonical",
          href: "https://jassmin.ua/blog/how-to-choose-a-perfume",
        },
      ]),
    );
  });

  it("titles the 404 page and keeps it out of the index", () => {
    const error = { status: 404, statusText: "", internal: false, data: null };
    expect(
      meta({
        loaderData: undefined,
        matches: EN,
        location: LOCATION,
        error,
      } as unknown as MetaArgs),
    ).toEqual([
      { title: "Article not found — Jassmin" },
      { name: "robots", content: "noindex, follow" },
    ]);
  });
});
