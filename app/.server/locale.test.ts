import { describe, expect, it } from "vitest";
import { getLocale, localeCookie, parseAcceptLanguage } from "./locale";

async function request({
  cookie,
  acceptLanguage,
}: {
  cookie?: unknown;
  acceptLanguage?: string;
} = {}): Promise<Request> {
  const headers = new Headers();
  if (cookie !== undefined) {
    // `serialize` returns a Set-Cookie header; a request only sends `name=value`.
    const [pair = ""] = (await localeCookie.serialize(cookie)).split(";");
    headers.set("Cookie", pair);
  }
  if (acceptLanguage !== undefined) {
    headers.set("Accept-Language", acceptLanguage);
  }
  return new Request("http://localhost/", { headers });
}

describe("parseAcceptLanguage", () => {
  it("matches the primary language subtag", () => {
    expect(parseAcceptLanguage("en-US,en;q=0.9")).toBe("en");
    expect(parseAcceptLanguage("uk-UA")).toBe("uk");
  });

  it("picks the best weighted supported language", () => {
    expect(parseAcceptLanguage("de, en;q=0.5")).toBe("en");
    expect(parseAcceptLanguage("en;q=0.4, uk;q=0.8")).toBe("uk");
    expect(parseAcceptLanguage("en;q=0, uk;q=0.1")).toBe("uk");
  });

  it("returns nothing for unsupported or missing languages", () => {
    expect(parseAcceptLanguage("ru")).toBeUndefined();
    expect(parseAcceptLanguage("*")).toBeUndefined();
    expect(parseAcceptLanguage("")).toBeUndefined();
    expect(parseAcceptLanguage(null)).toBeUndefined();
  });
});

describe("getLocale", () => {
  it("prefers the cookie over Accept-Language", async () => {
    expect(await getLocale(await request({ cookie: "en", acceptLanguage: "uk" }))).toBe("en");
    expect(await getLocale(await request({ cookie: "uk", acceptLanguage: "en" }))).toBe("uk");
  });

  it("falls back to Accept-Language when the cookie is missing or invalid", async () => {
    expect(await getLocale(await request({ acceptLanguage: "en-GB" }))).toBe("en");
    expect(await getLocale(await request({ cookie: "de", acceptLanguage: "en" }))).toBe("en");
    const garbage = new Request("http://localhost/", {
      headers: { Cookie: "locale=%%%", "Accept-Language": "en" },
    });
    expect(await getLocale(garbage)).toBe("en");
  });

  it("defaults to Ukrainian", async () => {
    expect(await getLocale(await request())).toBe("uk");
    expect(await getLocale(await request({ acceptLanguage: "ru, de" }))).toBe("uk");
  });
});
