import { describe, expect, it } from "vitest";

const { links, loader, meta, shouldRevalidate } = await import("./root");

type MetaArgs = Parameters<typeof meta>[0];

describe("root meta", () => {
  it("keeps unmatched URLs out of search results", () => {
    const error = { status: 404, statusText: "", internal: false, data: null };

    expect(meta({ matches: [], error } as unknown as MetaArgs)).toEqual([
      { title: "Сторінку не знайдено — Jassmin" },
      { name: "robots", content: "noindex, follow" },
    ]);
  });

  it("adds nothing when the page renders", () => {
    expect(meta({ matches: [], error: undefined } as unknown as MetaArgs)).toEqual([]);
  });
});

describe("root loader", () => {
  type LoaderArgs = Parameters<typeof loader>[0];
  const load = (url: string) =>
    loader({ request: new Request(url), params: {}, context: {} } as unknown as LoaderArgs);

  it("sends only the page language's messages (#96)", async () => {
    const english = await load("http://localhost/en/catalog/women");
    expect(english.locale).toBe("en");
    expect(english.messages.nav.about).toBe("About us");

    const ukrainian = await load("http://localhost/katalog/zhinochi");
    expect(ukrainian.locale).toBe("uk");
    expect(ukrainian.messages.nav.about).toBe("Про нас");
  });
});

describe("root shouldRevalidate", () => {
  type Args = Parameters<typeof shouldRevalidate>[0];
  const revalidates = (from: string, to: string, extra: Partial<Args> = {}) =>
    shouldRevalidate({
      currentUrl: new URL(from, "http://localhost"),
      nextUrl: new URL(to, "http://localhost"),
      defaultShouldRevalidate: true,
      ...extra,
    } as Args);

  it("reloads the messages when the language changes", () => {
    expect(revalidates("/katalog/zhinochi", "/en/catalog/women")).toBe(true);
    expect(revalidates("/en/cart", "/koshyk")).toBe(true);
  });

  it("keeps them after actions and navigations in the same language", () => {
    expect(revalidates("/koshyk", "/koshyk", { formMethod: "POST" })).toBe(false);
    expect(revalidates("/katalog/zhinochi", "/katalog/cholovichi")).toBe(false);
  });
});

describe("root links", () => {
  it("gives the stylesheet a precedence, so React puts it before the modulepreloads (#96)", () => {
    const stylesheets = links().filter((link) => "rel" in link && link.rel === "stylesheet");
    // Vitest resolves `app.css?url` to "", so only the attributes are checked.
    expect(stylesheets).toEqual([expect.objectContaining({ precedence: "default" })]);
  });
});
