import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductHandleResult } from "~/.server/services/products";
import type { ProductDetail } from "~/lib/products";

const mocks = vi.hoisted(() => ({
  resolveProductHandle: vi.fn(),
  render: vi.fn(),
}));
vi.mock("~/.server/services/products", () => ({
  resolveProductHandle: mocks.resolveProductHandle,
}));
vi.mock("~/.server/og/label-card", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/.server/og/label-card")>();
  mocks.render.mockImplementation(actual.renderShareCardPng);
  return { ...actual, renderShareCardPng: mocks.render };
});

const { clearShareCardCache } = await import("~/.server/og/label-card-cache");
const { loader, SHARE_IMAGE_CACHE_CONTROL, NOT_FOUND_CACHE_CONTROL } = await import(
  "./og.products.$file"
);

type LoaderArgs = Parameters<typeof loader>[0];

const publicId = "01a1652b-6e25-7c03-ae47-25b57131fb06";
const updatedAt = new Date("2026-11-01T10:00:00Z");

function product(overrides: Partial<ProductDetail> = {}): ProductDetail {
  return {
    id: publicId,
    slug: "baccarat-rouge-540",
    title: "Baccarat Rouge 540",
    brand: "Maison Francis Kurkdjian",
    gender: "women",
    packSize: 1,
    image: null,
    description: null,
    descriptionLocale: "uk",
    fragranceFamilies: ["квіткові"],
    notes: [],
    storeCode: null,
    variants: [],
    ...overrides,
  };
}

function found(overrides: Partial<Extract<ProductHandleResult, { kind: "product" }>> = {}) {
  return { kind: "product", id: 1, product: product(), available: true, updatedAt, ...overrides };
}

async function load(file: string, headers: Record<string, string> = {}): Promise<Response> {
  const request = new Request(`https://jassmin.ua/og/products/${file}`, { headers });
  try {
    return await loader({ request, params: { file } } as unknown as LoaderArgs);
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    throw thrown;
  }
}

beforeEach(() => {
  clearShareCardCache();
  mocks.resolveProductHandle.mockReset();
  mocks.render.mockClear();
});

describe("og/products/:file loader", () => {
  it("returns the 1200×630 PNG with cache headers", async () => {
    mocks.resolveProductHandle.mockResolvedValue(found());

    const response = await load("baccarat-rouge-540.png");
    const png = Buffer.from(await response.arrayBuffer());

    expect(mocks.resolveProductHandle).toHaveBeenCalledWith("baccarat-rouge-540", "uk");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Cache-Control")).toBe(SHARE_IMAGE_CACHE_CONTROL);
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=86400, stale-while-revalidate=604800",
    );
    expect(response.headers.get("ETag")).toMatch(new RegExp(`^"${publicId}-`));
    expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
    expect(png.subarray(12, 16).toString("latin1")).toBe("IHDR");
    expect({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) }).toEqual({
      width: 1200,
      height: 630,
    });
    expect(mocks.render).toHaveBeenCalledWith({
      id: publicId,
      brand: "Maison Francis Kurkdjian",
      title: "Baccarat Rouge 540",
      family: "квіткові",
    });
  });

  it("renders a product once for repeated requests", async () => {
    mocks.resolveProductHandle.mockResolvedValue(found());

    await load("baccarat-rouge-540.png");
    await load("baccarat-rouge-540.png");

    expect(mocks.render).toHaveBeenCalledTimes(1);
  });

  it("answers 304 to a matching If-None-Match, without rendering", async () => {
    mocks.resolveProductHandle.mockResolvedValue(found());
    const etag = (await load("baccarat-rouge-540.png")).headers.get("ETag") ?? "";
    clearShareCardCache();
    mocks.render.mockClear();

    for (const header of [etag, `W/${etag}`, `"other", ${etag}`, "*"]) {
      const response = await load("baccarat-rouge-540.png", { "If-None-Match": header });
      expect(response.status).toBe(304);
      expect(await response.text()).toBe("");
      expect(response.headers.get("ETag")).toBe(etag);
      expect(response.headers.get("Cache-Control")).toBe(SHARE_IMAGE_CACHE_CONTROL);
    }
    expect(mocks.render).not.toHaveBeenCalled();
  });

  it("renders again for a stale If-None-Match", async () => {
    mocks.resolveProductHandle.mockResolvedValue(found());
    const response = await load("baccarat-rouge-540.png", { "If-None-Match": '"stale"' });

    expect(response.status).toBe(200);
  });

  it("returns 404 for an unknown handle, an archived product or another file type", async () => {
    mocks.resolveProductHandle.mockResolvedValue(null);
    const unknown = await load("nothing.png");
    expect(unknown.status).toBe(404);
    expect(unknown.headers.get("Cache-Control")).toBe(NOT_FOUND_CACHE_CONTROL);

    mocks.resolveProductHandle.mockResolvedValue(found({ available: false }));
    expect((await load("baccarat-rouge-540.png")).status).toBe(404);

    mocks.resolveProductHandle.mockClear();
    expect((await load("baccarat-rouge-540.jpg")).status).toBe(404);
    expect((await load(".png")).status).toBe(404);
    expect(mocks.resolveProductHandle).not.toHaveBeenCalled();
    expect(mocks.render).not.toHaveBeenCalled();
  });

  it("redirects an old handle to the current image", async () => {
    mocks.resolveProductHandle.mockResolvedValue({
      kind: "redirect",
      publicId,
      slug: "baccarat-rouge-540",
    });

    const response = await load(`${publicId}.png`);

    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("/og/products/baccarat-rouge-540.png");
  });
});
