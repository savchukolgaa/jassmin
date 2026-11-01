import { afterEach, describe, expect, it, vi } from "vitest";
import type { BlogPost } from "~/lib/cms";
import { LOCALES } from "~/lib/i18n";
import { PAGE_KEYS, type Page, pathFor } from "~/lib/paths";

const content = vi.hoisted(() => ({ getBlogPostBySlug: vi.fn() }));
vi.mock("./cms/content", () => content);

const { localizedUrl } = await import("./paths");

const post = (alternates: BlogPost["alternates"], locale: BlogPost["locale"] = "uk") =>
  ({ locale, slug: alternates[locale], alternates }) as unknown as BlogPost;

const SAMPLE_PARAMS: Partial<Record<Page, Record<string, string>>> = {
  catalog: { gender: "men" },
  product: { handle: "bleu" },
  checkoutSuccess: { orderId: "1" },
  checkoutPay: { orderId: "1" },
  accountOrder: { id: "2" },
};

const build = pathFor as (
  locale: (typeof LOCALES)[number],
  page: Page,
  params?: Record<string, string>,
) => string;

afterEach(() => {
  vi.clearAllMocks();
});

describe("localizedUrl", () => {
  it("switches every page except blog posts to the same page in the other locale", async () => {
    for (const page of PAGE_KEYS.filter((p) => p !== "blogPost")) {
      const params = SAMPLE_PARAMS[page] ?? {};
      for (const from of LOCALES) {
        for (const to of LOCALES) {
          expect(await localizedUrl(build(from, page, params), to), `${page} ${from}→${to}`).toBe(
            build(to, page, params),
          );
        }
      }
    }
    expect(content.getBlogPostBySlug).not.toHaveBeenCalled();
  });

  it("keeps the query and the hash", async () => {
    expect(await localizedUrl("/katalog/zhinochi?page=2&brand=x#grid", "en")).toBe(
      "/en/catalog/women?page=2&brand=x#grid",
    );
    expect(await localizedUrl("/#about", "en")).toBe("/en#about");
  });

  it("sends a blog post to its translated slug", async () => {
    content.getBlogPostBySlug.mockResolvedValue(post({ uk: "yak-obraty", en: "how-to-choose" }));

    expect(await localizedUrl("/blog/yak-obraty", "en")).toBe("/en/blog/how-to-choose");
    expect(content.getBlogPostBySlug).toHaveBeenCalledWith("yak-obraty", "uk");
  });

  it("sends an English blog post back to its Ukrainian slug", async () => {
    content.getBlogPostBySlug.mockResolvedValue(
      post({ uk: "yak-obraty", en: "how-to-choose" }, "en"),
    );

    expect(await localizedUrl("/en/blog/how-to-choose", "uk")).toBe("/blog/yak-obraty");
    expect(content.getBlogPostBySlug).toHaveBeenCalledWith("how-to-choose", "en");
  });

  it("falls back to the blog list when the post isn't translated or the CMS fails", async () => {
    content.getBlogPostBySlug.mockResolvedValueOnce(post({ uk: "tilky-ukrainskoiu" }));
    expect(await localizedUrl("/blog/tilky-ukrainskoiu", "en")).toBe("/en/blog");

    content.getBlogPostBySlug.mockResolvedValueOnce(null);
    expect(await localizedUrl("/blog/nope", "en")).toBe("/en/blog");

    content.getBlogPostBySlug.mockRejectedValueOnce(new Error("down"));
    expect(await localizedUrl("/blog/x", "en")).toBe("/en/blog");
  });

  it("goes to the home page for paths that aren't pages", async () => {
    expect(await localizedUrl("/nope", "en")).toBe("/en");
    expect(await localizedUrl("/en/nope", "uk")).toBe("/");
  });
});
