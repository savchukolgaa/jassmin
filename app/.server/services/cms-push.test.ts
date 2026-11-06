import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { CmsGiftCardState, CmsOrderState, CmsProductState } from "~/lib/cms-sync";
import type { ClaimedCmsSync } from "../db/queries/cms-outbox";
import { hasDatabase, type TestDatabase } from "../db/test-utils";
import {
  type CmsSyncDeps,
  deliverCmsSync,
  describeCmsSyncReport,
  toStrapiGiftCardData,
  toStrapiOrderData,
  toStrapiProductData,
} from "./cms-push";

const order: CmsOrderState = {
  orderId: 7,
  status: "pending",
  paymentStatus: "unpaid",
  paymentMethod: "cod",
  customerName: "Олена Коваль",
  customerEmail: "olena@example.com",
  customerPhone: "+380671234567",
  userId: null,
  shippingAddress: "Київ, Відділення №12",
  freeShipping: true,
  subtotal: "6430.00",
  discountAmount: "0.00",
  shippingAmount: "0.00",
  giftCardAmount: "0.00",
  totalAmount: "6430.00",
  currency: "UAH",
  placedAt: "2026-10-25T10:00:00.000Z",
  paidAt: null,
  cancelledAt: null,
  refundedAt: null,
  shippedAt: null,
  completedAt: null,
  returnedAt: null,
  cancelReason: null,
  arrivedAt: null,
  arrivedAtBranch: false,
  waybillNumber: null,
  items: [
    {
      productPublicId: "01a1652b-6e25-7c03-ae47-25b57131fb06",
      productName: "Coco Mademoiselle",
      brand: "Chanel",
      volumeMl: 5,
      quantity: 2,
      unitPrice: "990.00",
    },
  ],
};

const product: CmsProductState = {
  publicId: "01a1652b-6e25-7c03-ae47-25b57131fb06",
  name: "Coco Mademoiselle",
  slug: "coco-mademoiselle",
  brand: "Chanel",
  description: "Квітковий шипровий аромат.",
  descriptionEn: "A floral chypre.",
  gender: "women",
  fragranceFamilies: ["шипрові", "квіткові"],
  notes: ["апельсин", "троянда"],
  storeCode: "1-D",
  popularRank: 2,
  packSize: 1,
  active: true,
  variants: [{ volumeMl: 5, price: "990.00", trackStock: true, stock: 8 }],
};

const giftCard: CmsGiftCardState = {
  giftCardId: 12,
  code: "ABCD2345EFGH6789",
  status: "active",
  initialAmount: "1000.00",
  balance: "400.00",
  currency: "UAH",
  buyerEmail: "buyer@example.com",
  recipientEmail: "friend@example.com",
  userId: null,
  placedAt: "2026-11-05T09:58:00.000Z",
  activatedAt: "2026-11-05T10:00:00.000Z",
  expiresAt: "2027-11-05T10:00:00.000Z",
  redemptions: [
    { orderId: 7, amount: "600.00", redeemedAt: "2026-11-06T10:00:00.000Z", reversedAt: null },
  ],
};

const env = { STRAPI_URL: "http://cms.test", STRAPI_SYNC_TOKEN: "write" };

function claimed(
  entity: "order" | "product" | "gift_card",
  entityId: number,
  version = 1,
): ClaimedCmsSync {
  return { id: entityId * 10, entity, entityId, version, attempts: 1 };
}

function fakeDeps(rows: ClaimedCmsSync[], overrides: Partial<CmsSyncDeps> = {}): CmsSyncDeps {
  let pending = [...rows];
  return {
    env,
    claim: vi.fn(async ({ limit }: { limit: number }) => {
      const batch = pending.slice(0, limit);
      pending = pending.slice(limit);
      return batch;
    }),
    loadOrder: vi.fn(async () => order),
    loadProduct: vi.fn(async () => product),
    loadGiftCard: vi.fn(async () => giftCard),
    markSynced: vi.fn(async () => {}),
    markFailed: vi.fn(async () => {}),
    ...overrides,
  };
}

/** Strapi with `existing` documents per collection; records every request. */
function stubStrapi(existing: Record<string, string[]> = {}, fail?: (url: URL) => boolean) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({
        method,
        path: `${input.pathname}${input.search}`,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (fail?.(input)) return new Response("boom", { status: 500 });
      const collection = input.pathname.split("/")[2] ?? "";
      if (method === "GET") {
        return Response.json({
          data: (existing[collection] ?? []).map((documentId) => ({ documentId })),
        });
      }
      return Response.json({ data: { documentId: "new-doc" } });
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("toStrapiOrderData / toStrapiProductData", () => {
  it("sends amounts as numbers for Strapi's decimal fields and the status as orderStatus", () => {
    expect(toStrapiOrderData(order)).toMatchObject({
      orderId: 7,
      orderStatus: "pending",
      subtotal: 6430,
      totalAmount: 6430,
      items: [{ unitPrice: 990, quantity: 2 }],
    });
    expect(toStrapiOrderData(order)).not.toHaveProperty("status");
    expect(toStrapiProductData(product)).toMatchObject({
      publicId: product.publicId,
      storeCode: "1-D",
      popularRank: 2,
      description: "Квітковий шипровий аромат.",
      descriptionEn: "A floral chypre.",
      // Strapi shows whether the size counts its stock (#98).
      variants: [{ volumeMl: 5, price: 990, trackStock: true, stock: 8 }],
    });
  });

  it("sends a gift card's amounts as numbers and its status as giftCardStatus (#125)", () => {
    expect(toStrapiGiftCardData(giftCard)).toEqual({
      giftCardId: 12,
      code: "ABCD2345EFGH6789",
      giftCardStatus: "active",
      initialAmount: 1000,
      balance: 400,
      currency: "UAH",
      buyerEmail: "buyer@example.com",
      recipientEmail: "friend@example.com",
      userId: null,
      placedAt: "2026-11-05T09:58:00.000Z",
      activatedAt: "2026-11-05T10:00:00.000Z",
      expiresAt: "2027-11-05T10:00:00.000Z",
      redemptions: [
        { orderId: 7, amount: 600, redeemedAt: "2026-11-06T10:00:00.000Z", reversedAt: null },
      ],
    });
    expect(toStrapiOrderData({ ...order, giftCardAmount: "500.00" }).giftCardAmount).toBe(500);
  });

  it("sends families and notes as Strapi component rows, primary first (#65)", () => {
    const data = toStrapiProductData(product);
    expect(data.fragranceFamilies).toEqual([{ family: "шипрові" }, { family: "квіткові" }]);
    expect(data.notes).toEqual([{ name: "апельсин" }, { name: "троянда" }]);
    expect(data).not.toHaveProperty("fragranceFamily");
  });
});

describe("deliverCmsSync", () => {
  it("updates the existing order document and creates a missing product", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const calls = stubStrapi({ orders: ["order-doc"] });
    const deps = fakeDeps([claimed("order", 7, 3), claimed("product", 1)]);

    const report = await deliverCmsSync({}, deps);

    expect(report).toEqual({ synced: 2, failed: 0, skipped: false });
    expect(calls.map((c) => [c.method, decodeURIComponent(c.path)])).toEqual([
      ["GET", "/api/orders?filters[orderId][$eq]=7&fields[0]=documentId"],
      ["PUT", "/api/orders/order-doc"],
      [
        "GET",
        "/api/products?filters[publicId][$eq]=01a1652b-6e25-7c03-ae47-25b57131fb06&fields[0]=documentId",
      ],
      ["POST", "/api/products"],
    ]);
    expect(calls[1]?.body).toEqual({ data: toStrapiOrderData(order) });
    expect(deps.markSynced).toHaveBeenCalledWith(70, 3);
    expect(deps.markSynced).toHaveBeenCalledWith(10, 1);
  });

  it("pushes a gift card with its balance and uses, keyed by its id (#125)", async () => {
    const calls = stubStrapi({ "gift-cards": ["card-doc"] });
    const deps = fakeDeps([claimed("gift_card", 12, 2)]);

    expect(await deliverCmsSync({}, deps)).toEqual({ synced: 1, failed: 0, skipped: false });
    expect(calls.map((c) => [c.method, decodeURIComponent(c.path)])).toEqual([
      ["GET", "/api/gift-cards?filters[giftCardId][$eq]=12&fields[0]=documentId"],
      ["PUT", "/api/gift-cards/card-doc"],
    ]);
    expect(calls[1]?.body).toEqual({ data: toStrapiGiftCardData(giftCard) });
    expect(deps.loadGiftCard).toHaveBeenCalledWith(12);
    expect(deps.markSynced).toHaveBeenCalledWith(120, 2);
  });

  it("keeps the error on a failed push and goes on with the rest", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubStrapi({}, (url) => url.pathname.startsWith("/api/orders"));
    const deps = fakeDeps([claimed("order", 7, 2), claimed("product", 1)]);

    const report = await deliverCmsSync({}, deps);

    expect(report).toEqual({ synced: 1, failed: 1, skipped: false });
    expect(deps.markFailed).toHaveBeenCalledWith(70, 2, expect.stringContaining("500"));
    expect(deps.markSynced).toHaveBeenCalledExactlyOnceWith(10, 1);
  });

  it("marks a vanished entity as synced without calling Strapi", async () => {
    const calls = stubStrapi();
    const deps = fakeDeps([claimed("order", 9)], { loadOrder: vi.fn(async () => undefined) });

    expect(await deliverCmsSync({}, deps)).toMatchObject({ synced: 1, failed: 0 });
    expect(calls).toEqual([]);
  });

  it("works through every batch", async () => {
    stubStrapi({ orders: ["d"] });
    const rows = [1, 2, 3].map((id) => claimed("order", id));
    const deps = fakeDeps(rows);

    expect(await deliverCmsSync({ limit: 2 }, deps)).toMatchObject({ synced: 3 });
    expect(deps.claim).toHaveBeenCalledTimes(2);
  });

  it("skips everything without the sync token", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const deps = fakeDeps([claimed("order", 7)]);

    const report = await deliverCmsSync({}, { ...deps, env: { STRAPI_URL: env.STRAPI_URL } });

    expect(report).toEqual({ synced: 0, failed: 0, skipped: true });
    expect(deps.claim).not.toHaveBeenCalled();
    expect(describeCmsSyncReport(report)).toContain("STRAPI_SYNC_TOKEN");
  });

  it("never rejects, even when building the deps throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const report = await deliverCmsSync({}, () => {
      throw new Error("no env");
    });

    expect(report).toEqual({ synced: 0, failed: 0, skipped: false });
  });
});

// Integration test: runs only when a database is configured, on its own throwaway database.
describe.skipIf(!hasDatabase)("cmsSyncDeps", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    const { createTestDatabase } = await import("../db/test-utils");
    const { migrateLatest } = await import("../db/migrator");
    const { seedProducts } = await import("../db/seed");
    testDb = await createTestDatabase("jassmin_cms_push_test");
    await migrateLatest(testDb.db);
    await seedProducts(testDb.db);
  });

  afterAll(async () => {
    await testDb?.drop();
  });

  it("gives a seeded product a slug before its first push", async () => {
    const { eq } = await import("drizzle-orm");
    const { products } = await import("../db/schema");
    const { cmsSyncDeps } = await import("./cms-push");
    const [sauvage] = await testDb.db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.publicId, "01a1652b-6e25-7c44-8d5b-bce46a20ad83"));

    const loaded = await cmsSyncDeps(testDb.db, env).loadProduct(sauvage?.id ?? 0);

    expect(loaded).toMatchObject({
      name: "Sauvage Eau de Toilette",
      slug: "sauvage-eau-de-toilette-6a20ad83",
      active: true,
    });
    expect(loaded?.variants.length).toBeGreaterThan(0);
  });
});
