import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { CMS_TIMEOUT_MS, cmsFetch, toStrapiQuery } from "./client";
import { CmsError, type CmsErrorKind, cmsUnavailable } from "./errors";

const env = vi.hoisted(() => ({
  STRAPI_URL: "http://cms.test",
  STRAPI_API_TOKEN: "test-token" as string | undefined,
}));

vi.mock("../env", () => ({ getEnv: () => env }));

const schema = z.object({ data: z.object({ title: z.string() }) });

function stubFetch(impl: () => Promise<Response>) {
  const fetchMock = vi.fn<typeof fetch>(impl);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function expectCmsError(promise: Promise<unknown>, kind: CmsErrorKind) {
  const error: unknown = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(CmsError);
  expect((error as CmsError).kind).toBe(kind);
  return error as CmsError;
}

afterEach(() => {
  vi.unstubAllGlobals();
  env.STRAPI_URL = "http://cms.test";
  env.STRAPI_API_TOKEN = "test-token";
});

describe("toStrapiQuery", () => {
  it("serializes nested objects and arrays in bracket notation", () => {
    const params = toStrapiQuery({
      filters: { slug: { $eq: "a b" } },
      populate: { seo: { populate: ["ogImage"] }, coverImage: true },
      sort: ["publishedAt:desc"],
      pagination: { page: 2 },
    });

    expect([...params]).toEqual([
      ["filters[slug][$eq]", "a b"],
      ["populate[seo][populate][0]", "ogImage"],
      ["populate[coverImage]", "true"],
      ["sort[0]", "publishedAt:desc"],
      ["pagination[page]", "2"],
    ]);
  });
});

describe("cmsFetch", () => {
  it("sends the bearer token and always asks for published content", async () => {
    const fetchMock = stubFetch(async () => Response.json({ data: { title: "Hi" } }));

    await expect(cmsFetch("blog-posts", { status: "draft" }, schema)).resolves.toEqual({
      data: { title: "Hi" },
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe("http://cms.test/api/blog-posts?status=published");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer test-token");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("keeps a path prefix in STRAPI_URL", async () => {
    env.STRAPI_URL = "https://jassmin.ua/cms";
    const fetchMock = stubFetch(async () => Response.json({ data: { title: "Hi" } }));

    await cmsFetch("home-page", {}, schema);

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://jassmin.ua/cms/api/home-page?status=published",
    );
  });

  it("asks for the given locale", async () => {
    const fetchMock = stubFetch(async () => Response.json({ data: { title: "Hi" } }));

    await cmsFetch("home-page", { locale: "uk" }, schema, { locale: "en" });

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.searchParams.getAll("locale")).toEqual(["en"]);
    expect(url.searchParams.get("status")).toBe("published");
  });

  it("sends no locale when none is given, so Strapi uses its default", async () => {
    const fetchMock = stubFetch(async () => Response.json({ data: { title: "Hi" } }));

    await cmsFetch("home-page", {}, schema);

    expect(new URL(String(fetchMock.mock.calls[0]?.[0])).searchParams.has("locale")).toBe(false);
  });

  it("fails with not_configured when the API token is missing, without calling Strapi", async () => {
    env.STRAPI_API_TOKEN = undefined;
    const fetchMock = stubFetch(async () => Response.json({}));

    await expectCmsError(cmsFetch("home-page", {}, schema), "not_configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails with unreachable when the network request fails", async () => {
    stubFetch(async () => {
      throw new TypeError("fetch failed");
    });

    await expectCmsError(cmsFetch("home-page", {}, schema), "unreachable");
  });

  it("fails with timeout when Strapi doesn't answer in time", async () => {
    stubFetch(async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    });

    const error = await expectCmsError(cmsFetch("home-page", {}, schema), "timeout");
    expect(error.message).toContain(String(CMS_TIMEOUT_MS));
  });

  it.each([401, 403, 404, 500])("fails with http and keeps status %i", async (status) => {
    stubFetch(async () => Response.json({ error: { status } }, { status }));

    const error = await expectCmsError(cmsFetch("home-page", {}, schema), "http");
    expect(error.status).toBe(status);
  });

  it("fails with invalid_response for a body that isn't JSON", async () => {
    stubFetch(async () => new Response("<html>proxy error</html>", { status: 200 }));

    await expectCmsError(cmsFetch("home-page", {}, schema), "invalid_response");
  });

  it("fails with invalid_response when the body doesn't match the schema", async () => {
    stubFetch(async () => Response.json({ data: { title: 42 } }));

    const error = await expectCmsError(cmsFetch("home-page", {}, schema), "invalid_response");
    expect(error.cause).toBeInstanceOf(z.ZodError);
  });
});

describe("cmsUnavailable", () => {
  it("turns a CmsError into a 503 response", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let thrown: unknown;

    try {
      cmsUnavailable(new CmsError("unreachable", "down"));
    } catch (error) {
      thrown = error;
    }

    // `data()` result; React Router turns it into the error response the ErrorBoundary sees.
    expect(thrown).toMatchObject({
      data: { message: "Content is temporarily unavailable" },
      init: { status: 503 },
    });
  });

  it("rethrows other errors unchanged", () => {
    const error = new Error("bug");

    expect(() => cmsUnavailable(error)).toThrow(error);
  });
});
