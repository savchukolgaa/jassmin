import type { Core } from "@strapi/strapi";
import { describe, expect, it } from "vitest";
import { applyProductAnswer, componentValues, productPayload } from "./middleware";

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
        variants: [{ volumeMl: 50, price: "3200.00", stock: 2 }],
      },
    );
    expect(data).toMatchObject({
      fragranceFamilies: [{ family: "квіткові" }, { family: "фруктові" }],
      notes: [{ name: "лимон" }],
      storeCode: null,
      variants: [{ id: 5, volumeMl: 50, price: 3200, stock: 2 }],
    });
  });
});
