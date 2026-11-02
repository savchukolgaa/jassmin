import { describe, expect, it } from "vitest";

const { links, meta } = await import("./root");

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

describe("root links", () => {
  it("gives the stylesheet a precedence, so React puts it before the modulepreloads (#96)", () => {
    const stylesheets = links().filter((link) => "rel" in link && link.rel === "stylesheet");
    // Vitest resolves `app.css?url` to "", so only the attributes are checked.
    expect(stylesheets).toEqual([expect.objectContaining({ precedence: "default" })]);
  });
});
