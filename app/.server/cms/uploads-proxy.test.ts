import { describe, expect, it, vi } from "vitest";
import { proxyUpload, UPLOAD_CACHE_CONTROL } from "./uploads-proxy";

const STRAPI_URL = "http://cms:1337";

function request(path: string, init?: RequestInit): Request {
  return new Request(`https://shop.example/uploads/${path}`, init);
}

function strapiFile(init?: ResponseInit): Response {
  return new Response("JPEGDATA", {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": "8",
      ETag: '"abc"',
      "Last-Modified": "Tue, 17 Nov 2026 10:00:00 GMT",
      "Set-Cookie": "koa.sess=1",
      Server: "Strapi",
    },
    ...init,
  });
}

describe("proxyUpload", () => {
  it("streams the file with its type and a year-long cache, dropping Strapi's other headers", async () => {
    const fetch = vi.fn(async () => strapiFile());
    const response = await proxyUpload({
      strapiUrl: STRAPI_URL,
      path: "small_photo_3f2a.jpg",
      request: request("small_photo_3f2a.jpg"),
      fetch,
    });

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe("http://cms:1337/uploads/small_photo_3f2a.jpg");
    expect(init.method).toBe("GET");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("JPEGDATA");
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    expect(response.headers.get("ETag")).toBe('"abc"');
    expect(response.headers.get("Last-Modified")).toBe("Tue, 17 Nov 2026 10:00:00 GMT");
    expect(response.headers.get("Cache-Control")).toBe(UPLOAD_CACHE_CONTROL);
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(response.headers.get("Server")).toBeNull();
  });

  it("keeps a path prefix in STRAPI_URL", async () => {
    const fetch = vi.fn(async () => strapiFile());
    await proxyUpload({
      strapiUrl: "https://example.com/cms/",
      path: "a.png",
      request: request("a.png"),
      fetch,
    });
    const [url] = fetch.mock.calls[0] as unknown as [URL];
    expect(url.toString()).toBe("https://example.com/cms/uploads/a.png");
  });

  it("forwards conditional headers and passes a 304 through", async () => {
    const fetch = vi.fn(
      async () => new Response(null, { status: 304, headers: { ETag: '"abc"' } }),
    );
    const response = await proxyUpload({
      strapiUrl: STRAPI_URL,
      path: "a.jpg",
      request: request("a.jpg", { headers: { "If-None-Match": '"abc"', Cookie: "session=1" } }),
      fetch,
    });

    const [, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    const sent = new Headers(init.headers);
    expect(sent.get("If-None-Match")).toBe('"abc"');
    expect(sent.get("Cookie")).toBeNull();
    expect(response.status).toBe(304);
    expect(response.headers.get("ETag")).toBe('"abc"');
    expect(response.headers.get("Cache-Control")).toBe(UPLOAD_CACHE_CONTROL);
  });

  it("answers HEAD without a body", async () => {
    const fetch = vi.fn(async () => strapiFile());
    const response = await proxyUpload({
      strapiUrl: STRAPI_URL,
      path: "a.jpg",
      request: request("a.jpg", { method: "HEAD" }),
      fetch,
    });
    const [, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect(init.method).toBe("HEAD");
    expect(response.status).toBe(200);
    expect(response.body).toBeNull();
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
  });

  it("passes a 404 through, uncached", async () => {
    const fetch = vi.fn(async () => new Response("Not Found", { status: 404 }));
    const response = await proxyUpload({
      strapiUrl: STRAPI_URL,
      path: "missing.jpg",
      request: request("missing.jpg"),
      fetch,
    });
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("answers 502 when Strapi fails, times out or redirects", async () => {
    for (const fetch of [
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
      vi.fn(async () => {
        throw new DOMException("timed out", "TimeoutError");
      }),
      vi.fn(async () => new Response("boom", { status: 500 })),
      vi.fn(async () => new Response(null, { status: 302, headers: { Location: "/x" } })),
    ]) {
      const response = await proxyUpload({
        strapiUrl: STRAPI_URL,
        path: "a.jpg",
        request: request("a.jpg"),
        fetch,
      });
      expect(response.status).toBe(502);
    }
  });

  it("refuses paths that aren't plain file names, without calling Strapi", async () => {
    const fetch = vi.fn(async () => strapiFile());
    for (const path of [
      undefined,
      "",
      "../admin",
      "a/../../etc/passwd",
      "..",
      ".env",
      "a//b.jpg",
      "a/",
      "%2e%2e/secret",
      "a b.jpg",
      "a.jpg?x=1",
      "x".repeat(600),
    ]) {
      const response = await proxyUpload({
        strapiUrl: STRAPI_URL,
        path,
        request: request("x"),
        fetch,
      });
      expect(response.status, String(path)).toBe(404);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("accepts nested Strapi folders", async () => {
    const fetch = vi.fn(async () => strapiFile());
    const response = await proxyUpload({
      strapiUrl: STRAPI_URL,
      path: "2026/11/large_photo_3f2a.webp",
      request: request("2026/11/large_photo_3f2a.webp"),
      fetch,
    });
    expect(response.status).toBe(200);
  });
});
