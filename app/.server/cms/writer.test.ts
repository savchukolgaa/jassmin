import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { cmsWrite } from "./writer";

function stubFetch(impl: (input: URL, init?: RequestInit) => Promise<Response>) {
  const fetchMock = vi.fn<typeof fetch>(impl as typeof fetch);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const env = { STRAPI_URL: "http://cms.test/prefix", STRAPI_SYNC_TOKEN: "write-token" };
const schema = z.object({ data: z.object({ documentId: z.string() }) });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("cmsWrite", () => {
  it("sends the data envelope with the sync token, keeping the URL prefix", async () => {
    const fetchMock = stubFetch(async () => Response.json({ data: { documentId: "abc" } }));

    const result = await cmsWrite(
      env,
      { method: "PUT", path: "orders/abc", data: { status: "shipped" } },
      schema,
    );

    expect(result).toEqual({ data: { documentId: "abc" } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe("http://cms.test/prefix/api/orders/abc");
    expect(init.method).toBe("PUT");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer write-token");
    expect(JSON.parse(String(init.body))).toEqual({ data: { status: "shipped" } });
  });

  it("serializes the query of a GET", async () => {
    const fetchMock = stubFetch(async () => Response.json({ data: { documentId: "abc" } }));

    await cmsWrite(
      env,
      { method: "GET", path: "orders", query: { filters: { orderId: { $eq: 7 } } } },
      schema,
    );

    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.searchParams.get("filters[orderId][$eq]")).toBe("7");
    expect(init.body).toBeUndefined();
  });

  it("fails as not configured without the sync token", async () => {
    await expect(
      cmsWrite({ STRAPI_URL: env.STRAPI_URL }, { method: "GET", path: "orders" }, schema),
    ).rejects.toMatchObject({ kind: "not_configured" });
  });

  it("turns an error status into an http CmsError with Strapi's message", async () => {
    stubFetch(async () => new Response('{"error":"Forbidden"}', { status: 403 }));

    await expect(
      cmsWrite(env, { method: "POST", path: "orders", data: {} }, schema),
    ).rejects.toMatchObject({
      kind: "http",
      status: 403,
      message: expect.stringContaining("Forbidden"),
    });
  });

  it("rejects an unexpected response", async () => {
    stubFetch(async () => Response.json({ nope: true }));

    await expect(cmsWrite(env, { method: "GET", path: "orders" }, schema)).rejects.toMatchObject({
      kind: "invalid_response",
    });
  });
});
