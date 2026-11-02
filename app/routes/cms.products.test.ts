import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CmsProductResult } from "~/.server/services/cms-sync";
import type { CmsProductChange } from "~/lib/cms-sync";

const SECRET = "s".repeat(32);

const applyCmsProductChange = vi.hoisted(() =>
  vi.fn(
    async (_change: CmsProductChange): Promise<CmsProductResult> => ({
      ok: true,
      product: {
        publicId: "01a1652b-6e25-7c03-ae47-25b57131fb06",
        name: "Coco",
        slug: "coco",
        brand: "Chanel",
        description: null,
        gender: "women",
        fragranceFamilies: ["квіткові"],
        notes: [],
        storeCode: null,
        popularRank: null,
        packSize: 1,
        active: true,
        variants: [{ volumeMl: 50, price: "6850.00", trackStock: true, stock: 4 }],
      },
    }),
  ),
);

vi.mock("~/.server/services/cms-sync", () => ({ applyCmsProductChange }));
vi.mock("~/.server/env", () => ({
  getEnv: () => ({ CMS_SYNC_SECRET: SECRET, STRAPI_URL: "http://cms.test" }),
}));

type ActionArgs = Parameters<typeof import("./cms.products").action>[0];

function post(body: string, secret = SECRET): ActionArgs {
  const request = new Request("http://localhost/cms/products", {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body,
  });
  return { request, params: {}, context: {} } as unknown as ActionArgs;
}

const update = {
  action: "update",
  publicId: "01a1652b-6e25-7c03-ae47-25b57131fb06",
  name: " Coco ",
  slug: "coco",
  brand: "Chanel",
  gender: "women",
  fragranceFamilies: ["квіткові", "фруктові"],
  notes: [" жасмин ", "Жасмин", "", "мускус"],
  storeCode: " 3-D ",
  popularRank: 4,
  variants: [{ volumeMl: 50, price: 6850, stock: 5, expectedStock: 6 }],
};

describe("cms products sync route", () => {
  beforeEach(() => {
    applyCmsProductChange.mockClear();
  });

  it("applies a valid change and answers with the stored product", async () => {
    const { action } = await import("./cms.products");

    const response = await action(post(JSON.stringify(update)));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ slug: "coco", variants: [{ stock: 4 }] });
    expect(applyCmsProductChange).toHaveBeenCalledWith({
      ...update,
      name: "Coco",
      description: null,
      notes: ["жасмин", "мускус"],
      storeCode: "3-D",
      imageUrl: null,
      imageWidth: null,
      imageHeight: null,
      imageFormats: null,
      packSize: 1,
      active: true,
      // Strapi sent no `trackStock`: the size stays untracked (#98).
      variants: [{ volumeMl: 50, price: "6850.00", trackStock: false, stock: 5, expectedStock: 6 }],
    });
  });

  it("resolves Strapi's relative image URL against the CMS origin", async () => {
    const { action } = await import("./cms.products");

    await action(post(JSON.stringify({ ...update, imageUrl: "/uploads/coco.jpg" })));

    expect(applyCmsProductChange.mock.calls[0]?.[0]).toMatchObject({
      imageUrl: "http://cms.test/uploads/coco.jpg",
    });
  });

  it("resolves the image formats' URLs too (#88)", async () => {
    const { action } = await import("./cms.products");

    await action(
      post(
        JSON.stringify({
          ...update,
          imageUrl: "/uploads/coco.jpg",
          imageWidth: 800,
          imageHeight: 1000,
          imageFormats: [{ url: "/uploads/small_coco.jpg", width: 400, height: 500 }],
        }),
      ),
    );

    expect(applyCmsProductChange.mock.calls[0]?.[0]).toMatchObject({
      imageWidth: 800,
      imageHeight: 1000,
      imageFormats: [{ url: "http://cms.test/uploads/small_coco.jpg", width: 400, height: 500 }],
    });
  });

  it("refuses an image URL that isn't http(s) or a path", async () => {
    const { action } = await import("./cms.products");

    const response = await action(post(JSON.stringify({ ...update, imageUrl: "javascript:x" })));

    expect(response.status).toBe(422);
  });

  it("rejects a wrong secret before reading the body", async () => {
    const { action } = await import("./cms.products");

    expect((await action(post(JSON.stringify(update), "x".repeat(32)))).status).toBe(401);
    expect(applyCmsProductChange).not.toHaveBeenCalled();
  });

  it("answers 400 for a body that isn't JSON", async () => {
    const { action } = await import("./cms.products");

    expect((await action(post("{"))).status).toBe(400);
  });

  it("answers 422 with the issues for an invalid size", async () => {
    const { action } = await import("./cms.products");

    const response = await action(
      post(JSON.stringify({ ...update, variants: [{ volumeMl: 75, price: 0, stock: -1 }] })),
    );

    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: string; issues: { path: string }[] };
    expect(body.error).toBe("invalid-input");
    expect(body.issues.map((issue) => issue.path)).toEqual([
      "variants.0.volumeMl",
      "variants.0.price",
      "variants.0.stock",
    ]);
    expect(applyCmsProductChange).not.toHaveBeenCalled();
  });

  it("answers 422 for a family outside the list or a perfume without one", async () => {
    const { action } = await import("./cms.products");

    for (const fragranceFamilies of [["мікс"], ["квіткові", "квіткові"], []]) {
      const response = await action(post(JSON.stringify({ ...update, fragranceFamilies })));
      expect(response.status).toBe(422);
      const body = (await response.json()) as { error: string; issues: { path: string }[] };
      expect(body.error).toBe("invalid-input");
      expect(body.issues.map((issue) => issue.path)).toEqual([
        fragranceFamilies.length === 1 ? "fragranceFamilies.0" : "fragranceFamilies",
      ]);
    }
    expect(applyCmsProductChange).not.toHaveBeenCalled();
  });

  it("answers 422 with the service's error", async () => {
    applyCmsProductChange.mockResolvedValueOnce({ ok: false, error: "slug-taken", slug: "coco" });
    const { action } = await import("./cms.products");

    const response = await action(post(JSON.stringify(update)));

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "slug-taken", slug: "coco" });
  });
});
