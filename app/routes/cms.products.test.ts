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
        fragranceFamily: null,
        packSize: 1,
        active: true,
        variants: [{ volumeMl: 50, price: "6850.00", stock: 4 }],
      },
    }),
  ),
);

vi.mock("~/.server/services/cms-sync", () => ({ applyCmsProductChange }));
vi.mock("~/.server/env", () => ({ getEnv: () => ({ CMS_SYNC_SECRET: SECRET }) }));

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
      fragranceFamily: null,
      imageUrl: null,
      packSize: 1,
      active: true,
      variants: [{ volumeMl: 50, price: "6850.00", stock: 5, expectedStock: 6 }],
    });
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

  it("answers 422 with the service's error", async () => {
    applyCmsProductChange.mockResolvedValueOnce({ ok: false, error: "slug-taken", slug: "coco" });
    const { action } = await import("./cms.products");

    const response = await action(post(JSON.stringify(update)));

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "slug-taken", slug: "coco" });
  });
});
