import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearShareCardCache, getOrRender, MAX_ENTRIES } from "./label-card-cache";

const png = (text: string) => Buffer.from(text);

beforeEach(() => {
  clearShareCardCache();
});

describe("getOrRender", () => {
  it("renders once per key", async () => {
    const render = vi.fn(async () => png("a"));

    expect(await getOrRender("a:1", render)).toEqual(png("a"));
    expect(await getOrRender("a:1", render)).toEqual(png("a"));
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("shares one render between concurrent requests", async () => {
    const render = vi.fn(async () => png("a"));

    const [first, second] = await Promise.all([
      getOrRender("a:1", render),
      getOrRender("a:1", render),
    ]);

    expect(first).toBe(second);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("renders again with a new update time", async () => {
    const render = vi.fn(async () => png("a"));

    await getOrRender("a:1", render);
    await getOrRender("a:2", render);

    expect(render).toHaveBeenCalledTimes(2);
  });

  it("forgets a failed render", async () => {
    const failing = vi.fn(async (): Promise<Buffer> => {
      throw new Error("boom");
    });
    await expect(getOrRender("a:1", failing)).rejects.toThrow("boom");

    const render = vi.fn(async () => png("a"));
    expect(await getOrRender("a:1", render)).toEqual(png("a"));
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("evicts the least recently used image past the limit", async () => {
    const render = vi.fn(async () => png("x"));
    for (let i = 0; i < MAX_ENTRIES; i++) {
      await getOrRender(`p${i}`, render);
    }
    await getOrRender("p0", render); // p0 is now the most recent; p1 the oldest
    await getOrRender("new", render);
    render.mockClear();

    await getOrRender("p0", render);
    expect(render).not.toHaveBeenCalled();
    await getOrRender("p1", render);
    expect(render).toHaveBeenCalledTimes(1);
  });
});
