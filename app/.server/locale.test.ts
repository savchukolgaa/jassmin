import { describe, expect, it } from "vitest";
import {
  getChosenLocale,
  getLocale,
  localeCookie,
  parseAcceptLanguage,
  shouldSuggestEnglish,
} from "./locale";

async function request({
  path = "/",
  cookie,
  acceptLanguage,
}: {
  path?: string;
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
  return new Request(`http://localhost${path}`, { headers });
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
  it("reads the locale from the URL alone", async () => {
    expect(await getLocale(await request({ path: "/en/cart" }))).toBe("en");
    expect(await getLocale(await request({ path: "/en" }))).toBe("en");
    expect(await getLocale(await request({ path: "/koshyk" }))).toBe("uk");
  });

  it("ignores the cookie and Accept-Language", async () => {
    expect(await getLocale(await request({ cookie: "en", acceptLanguage: "en" }))).toBe("uk");
    expect(
      await getLocale(await request({ path: "/en", cookie: "uk", acceptLanguage: "uk" })),
    ).toBe("en");
  });

  it("resolves a single-fetch data request like its page (#112)", async () => {
    // React Router v8 passes loaders the raw `.data` request of a client-side navigation.
    expect(await getLocale(await request({ path: "/en.data" }))).toBe("en");
    expect(await getLocale(await request({ path: "/en/popular.data?_routes=x" }))).toBe("en");
    expect(await getLocale(await request({ path: "/_.data" }))).toBe("uk");
    expect(await getLocale(await request({ path: "/koshyk.data" }))).toBe("uk");
  });
});

describe("getChosenLocale", () => {
  it("is the cookie when it holds a supported locale", async () => {
    expect(await getChosenLocale(await request({ cookie: "en" }))).toBe("en");
    expect(await getChosenLocale(await request({ cookie: "de" }))).toBeUndefined();
    expect(await getChosenLocale(await request())).toBeUndefined();
    const garbage = new Request("http://localhost/", { headers: { Cookie: "locale=%%%" } });
    expect(await getChosenLocale(garbage)).toBeUndefined();
  });
});

describe("shouldSuggestEnglish", () => {
  it("suggests English on a Ukrainian page to a browser preferring it", async () => {
    expect(await shouldSuggestEnglish(await request({ acceptLanguage: "en-GB,en" }))).toBe(true);
  });

  it("doesn't once a language was chosen, on English pages or for other browsers", async () => {
    expect(await shouldSuggestEnglish(await request({ acceptLanguage: "en", cookie: "uk" }))).toBe(
      false,
    );
    expect(await shouldSuggestEnglish(await request({ acceptLanguage: "en", cookie: "en" }))).toBe(
      false,
    );
    expect(await shouldSuggestEnglish(await request({ path: "/en", acceptLanguage: "en" }))).toBe(
      false,
    );
    expect(await shouldSuggestEnglish(await request({ acceptLanguage: "uk,en;q=0.5" }))).toBe(
      false,
    );
    expect(await shouldSuggestEnglish(await request())).toBe(false);
  });

  it("answers a data request like its page (#112)", async () => {
    expect(
      await shouldSuggestEnglish(await request({ path: "/_.data", acceptLanguage: "en" })),
    ).toBe(true);
    expect(
      await shouldSuggestEnglish(await request({ path: "/en.data", acceptLanguage: "en" })),
    ).toBe(false);
  });
});
