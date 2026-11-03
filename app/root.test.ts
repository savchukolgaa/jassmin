import { describe, expect, it, vi } from "vitest";

vi.mock("~/.server/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/.server/env")>()),
  getEnv: () => ({ PUBLIC_SITE_URL: undefined }),
}));

const { links, loader, meta, shouldRevalidate } = await import("./root");

type MetaArgs = Parameters<typeof meta>[0];
type RevalidateArgs = Parameters<typeof shouldRevalidate>[0];
type LoaderArgs = Parameters<typeof loader>[0];

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

describe("root links", () => {
  it("gives the stylesheet a precedence, so React puts it before the modulepreloads (#96)", () => {
    const stylesheets = links().filter((link) => "rel" in link && link.rel === "stylesheet");
    // Vitest resolves `app.css?url` to "", so only the attributes are checked.
    expect(stylesheets).toEqual([expect.objectContaining({ precedence: "default" })]);
  });
});

describe("root shouldRevalidate", () => {
  const url = (path: string) => new URL(path, "http://localhost");
  const args = (overrides: Partial<RevalidateArgs>) =>
    ({
      currentUrl: url("/"),
      nextUrl: url("/"),
      defaultShouldRevalidate: false,
      ...overrides,
    }) as RevalidateArgs;

  it("reloads the locale after the language switcher, in either direction (#112)", () => {
    const switched = {
      formMethod: "POST",
      formAction: "/locale",
      defaultShouldRevalidate: true,
    } as const;
    expect(shouldRevalidate(args({ ...switched, currentUrl: url("/"), nextUrl: url("/en") }))).toBe(
      true,
    );
    expect(
      shouldRevalidate(args({ ...switched, currentUrl: url("/en/cart"), nextUrl: url("/koshyk") })),
    ).toBe(true);
  });

  it("reloads on any navigation into the other language", () => {
    expect(shouldRevalidate(args({ currentUrl: url("/populiarni"), nextUrl: url("/en") }))).toBe(
      true,
    );
  });

  it("follows the default within one language, e.g. after an action", () => {
    expect(shouldRevalidate(args({ nextUrl: url("/koshyk") }))).toBe(false);
    expect(
      shouldRevalidate(
        args({ formMethod: "POST", formAction: "/koshyk", defaultShouldRevalidate: true }),
      ),
    ).toBe(true);
  });
});

describe("root loader", () => {
  const load = (url: string) =>
    loader({ request: new Request(url), params: {}, context: {} } as unknown as LoaderArgs);

  it("gives a client-side navigation the locale of its page, not of its data URL (#112)", async () => {
    // React Router fetches `/en.data` for `/en` and passes loaders that raw request.
    expect(await load("http://localhost/en.data")).toMatchObject({ locale: "en" });
    expect(await load("http://localhost/_.data")).toMatchObject({ locale: "uk" });
    expect(await load("http://localhost/en/cart.data?_routes=root")).toMatchObject({
      locale: "en",
    });
  });

  it("gives a document request the locale of its URL", async () => {
    expect(await load("http://localhost/en")).toMatchObject({
      locale: "en",
      site: { url: "http://localhost" },
    });
  });
});
