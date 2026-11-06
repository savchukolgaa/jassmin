import type { Core } from "@strapi/strapi";
import { describe, expect, it } from "vitest";
import {
  applyProductAnswer,
  componentValues,
  createSyncMiddleware,
  GIFT_CARD_UID,
  productPayload,
  toOrderChange,
  toOrderData,
} from "./middleware";

// Without an image the payload never reads from Strapi, so an empty instance is enough.
const strapi = {} as Core.Strapi;

const stored = {
  name: "Light Blue",
  slug: "light-blue",
  brand: "Dolce & Gabbana",
  gender: "women",
  fragranceFamilies: [
    { id: 1, family: "квіткові" },
    { id: 2, family: "фруктові" },
  ],
  notes: [
    { id: 3, name: "лимон" },
    { id: 4, name: "зелене яблуко" },
  ],
  storeCode: "3-D",
  popularRank: 2,
  variants: [{ id: 5, volumeMl: 50, price: 3200, stock: 2 }],
};

describe("componentValues", () => {
  it("reads one field of each component row, in order", () => {
    expect(componentValues(stored.fragranceFamilies, "family")).toEqual(["квіткові", "фруктові"]);
    expect(componentValues(undefined, "family")).toEqual([]);
  });
});

describe("productPayload (#65)", () => {
  it("sends families primary first, notes and the store code", async () => {
    expect(await productPayload(strapi, stored, stored)).toMatchObject({
      fragranceFamilies: ["квіткові", "фруктові"],
      notes: ["лимон", "зелене яблуко"],
      storeCode: "3-D",
    });
  });

  it("keeps the stored families when the edit doesn't send them, and takes reordered ones", async () => {
    const reordered = {
      ...stored,
      fragranceFamilies: [{ family: "фруктові" }, { id: 1, family: "квіткові" }],
    };
    expect((await productPayload(strapi, reordered, stored)).fragranceFamilies).toEqual([
      "фруктові",
      "квіткові",
    ]);
    const cleared = await productPayload(strapi, { ...stored, notes: [], storeCode: " " }, stored);
    expect(cleared).toMatchObject({ notes: [], storeCode: null });
  });
});

describe("productPayload: popular position (#67)", () => {
  it("sends the position, and none once staff empty the field", async () => {
    expect((await productPayload(strapi, stored, stored)).popularRank).toBe(2);
    for (const popularRank of [null, undefined, ""]) {
      expect((await productPayload(strapi, { ...stored, popularRank }, stored)).popularRank).toBe(
        null,
      );
    }
  });
});

describe("productPayload: descriptions (#100)", () => {
  it("sends both languages, and none for an emptied field", async () => {
    const described = { ...stored, description: "Квітковий аромат.", descriptionEn: "A floral." };
    expect(await productPayload(strapi, described, stored)).toMatchObject({
      description: "Квітковий аромат.",
      descriptionEn: "A floral.",
    });
    expect(
      await productPayload(strapi, { ...described, descriptionEn: " " }, stored),
    ).toMatchObject({ description: "Квітковий аромат.", descriptionEn: null });
    expect(await productPayload(strapi, stored, stored)).toMatchObject({
      description: null,
      descriptionEn: null,
    });
  });
});

describe("applyProductAnswer (#65)", () => {
  it("saves the families, notes and store code the app stored", () => {
    const data = applyProductAnswer(
      { ...stored, notes: [{ name: " лимон " }, { name: "Лимон" }] },
      {
        publicId: "01a1652b-6e25-7c03-ae47-25b57131fb06",
        active: true,
        fragranceFamilies: ["квіткові", "фруктові"],
        notes: ["лимон"],
        storeCode: null,
        popularRank: 5,
        description: "Квітковий аромат.",
        descriptionEn: null,
        variants: [{ volumeMl: 50, price: "3200.00", stock: 2 }],
      },
    );
    expect(data).toMatchObject({
      description: "Квітковий аромат.",
      descriptionEn: null,
      fragranceFamilies: [{ family: "квіткові" }, { family: "фруктові" }],
      notes: [{ name: "лимон" }],
      storeCode: null,
      popularRank: 5,
      variants: [{ id: 5, volumeMl: 50, price: 3200, stock: 2 }],
    });
  });
});

describe("productPayload: tracked stock (#98)", () => {
  it("sends whether each size tracks stock, untracked when Strapi has no value", async () => {
    const merged = {
      ...stored,
      variants: [
        { id: 5, volumeMl: 50, price: 3200, stock: 2, trackStock: true },
        { volumeMl: 10, price: 240 },
      ],
    };
    expect((await productPayload(strapi, merged, stored)).variants).toEqual([
      { volumeMl: 50, price: 3200, trackStock: true, stock: 2, expectedStock: 2 },
      { volumeMl: 10, price: 240, trackStock: false, stock: 0, expectedStock: null },
    ]);
  });

  it("keeps the stored stock when the admin hides the field", async () => {
    const hidden = {
      ...stored,
      variants: [{ id: 5, volumeMl: 50, price: 3200, trackStock: false }],
    };
    expect((await productPayload(strapi, hidden, stored)).variants).toEqual([
      { volumeMl: 50, price: 3200, trackStock: false, stock: 2, expectedStock: 2 },
    ]);
  });

  it("saves the app's tracking and stock", () => {
    const data = applyProductAnswer(stored, {
      publicId: "01a1652b-6e25-7c03-ae47-25b57131fb06",
      active: true,
      fragranceFamilies: [],
      notes: [],
      storeCode: null,
      popularRank: null,
      variants: [{ volumeMl: 50, price: "3200.00", stock: 2, trackStock: false }],
    });
    expect(data.variants).toEqual([
      { id: 5, volumeMl: 50, price: 3200, stock: 2, trackStock: false },
    ]);
  });
});

describe("productPayload: image (#88)", () => {
  const file = {
    id: 7,
    url: "/uploads/coco_1a2b.jpg",
    width: 1200,
    height: 1500,
    formats: {
      thumbnail: { url: "/uploads/thumbnail_coco_1a2b.jpg", width: 125, height: 156 },
      small: { url: "/uploads/small_coco_1a2b.jpg", width: 400, height: 500 },
      broken: { url: "/uploads/x.jpg" },
    },
  };
  const withUploads = {
    db: { query: () => ({ findOne: async () => file }) },
  } as unknown as Core.Strapi;

  it("sends the image's URL, size and resized formats, read by its id", async () => {
    expect(await productPayload(withUploads, { ...stored, image: 7 }, stored)).toMatchObject({
      imageUrl: "/uploads/coco_1a2b.jpg",
      imageWidth: 1200,
      imageHeight: 1500,
      imageFormats: [
        { url: "/uploads/thumbnail_coco_1a2b.jpg", width: 125, height: 156 },
        { url: "/uploads/small_coco_1a2b.jpg", width: 400, height: 500 },
      ],
    });
  });

  it("reads a media object without an id directly", async () => {
    const { id: _id, ...media } = file;
    const payload = await productPayload(strapi, { ...stored, image: media }, stored);
    expect(payload).toMatchObject({ imageUrl: file.url, imageWidth: 1200, imageHeight: 1500 });
    expect(payload.imageFormats).toHaveLength(2);
  });

  it("sends no image data without an image", async () => {
    expect(await productPayload(strapi, { ...stored, image: null }, stored)).toMatchObject({
      imageUrl: null,
      imageWidth: null,
      imageHeight: null,
      imageFormats: null,
    });
  });
});

describe("gift cards (#125)", () => {
  /** A Strapi whose current request comes from the admin, as a staff edit does. */
  const adminStrapi = {
    requestContext: { get: () => ({ state: { auth: { strategy: { name: "admin" } } } }) },
  } as unknown as Core.Strapi;
  type Middleware = (context: unknown, next: () => Promise<unknown>) => Promise<unknown>;

  it("refuses every staff save of a gift card, and lets the app's pushes through", async () => {
    const middleware = createSyncMiddleware(adminStrapi) as unknown as Middleware;
    for (const action of ["create", "update", "delete", "clone"]) {
      let saved = false;
      await expect(
        middleware({ uid: GIFT_CARD_UID, action, params: {} }, async () => {
          saved = true;
        }),
      ).rejects.toThrow("Подарункові картки змінюються лише в магазині");
      expect(saved).toBe(false);
    }

    const tokenStrapi = {
      requestContext: { get: () => ({ state: {} }) },
    } as unknown as Core.Strapi;
    const push = createSyncMiddleware(tokenStrapi) as unknown as Middleware;
    let pushed = false;
    await push({ uid: GIFT_CARD_UID, action: "update", params: {} }, async () => {
      pushed = true;
    });
    expect(pushed).toBe(true);
  });

  it("saves what a gift card paid of an order as a number", () => {
    expect(
      toOrderData({ orderId: 7, status: "paid", giftCardAmount: "500.00", items: [] }),
    ).toMatchObject({ orderStatus: "paid", giftCardAmount: 500 });
  });
});

describe("toOrderChange (#138)", () => {
  it("sends the statuses, the waybill and the arrival checkbox", () => {
    expect(
      toOrderChange({
        orderStatus: "shipped",
        paymentStatus: "unpaid",
        waybillNumber: "2045 0000 0000 01",
        arrivedAtBranch: true,
        customerName: "ignored",
      }),
    ).toEqual({
      status: "shipped",
      paymentStatus: "unpaid",
      waybillNumber: "2045 0000 0000 01",
      arrivedAtBranch: true,
    });
  });

  it("removes a cleared waybill and leaves fields the form didn't send", () => {
    expect(toOrderChange({ waybillNumber: null, arrivedAtBranch: null })).toEqual({
      status: undefined,
      paymentStatus: undefined,
      waybillNumber: null,
      arrivedAtBranch: undefined,
    });
    expect(toOrderChange({})).toMatchObject({ waybillNumber: undefined });
  });
});
