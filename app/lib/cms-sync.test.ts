import { describe, expect, it } from "vitest";
import { cmsProductChangeSchema, MAX_PRODUCT_NOTES } from "./cms-sync";

const create = {
  action: "create",
  name: "Light Blue",
  slug: "light-blue",
  brand: "Dolce & Gabbana",
  gender: "women",
  fragranceFamilies: ["квіткові", "фруктові"],
  variants: [{ volumeMl: 50, price: 3200, stock: 1 }],
};

const parse = (overrides: Record<string, unknown>) =>
  cmsProductChangeSchema.safeParse({ ...create, ...overrides });

const issues = (overrides: Record<string, unknown>) => {
  const result = parse(overrides);
  return result.success ? [] : result.error.issues.map((i) => [i.path.join("."), i.message]);
};

describe("cmsProductChangeSchema: families, notes and store code (#65)", () => {
  it("keeps the families in order and defaults notes and the store code", () => {
    expect(parse({}).data).toMatchObject({
      fragranceFamilies: ["квіткові", "фруктові"],
      notes: [],
      storeCode: null,
    });
  });

  it("accepts only families from the list, once each", () => {
    expect(issues({ fragranceFamilies: ["мікс"] })[0]?.[0]).toBe("fragranceFamilies.0");
    expect(issues({ fragranceFamilies: ["Квіткові"] })[0]?.[0]).toBe("fragranceFamilies.0");
    expect(issues({ fragranceFamilies: ["квіткові", "квіткові"] })).toEqual([
      ["fragranceFamilies", "duplicate-family"],
    ]);
  });

  it("requires a family for a single perfume but not for a set", () => {
    expect(issues({ fragranceFamilies: [] })).toEqual([["fragranceFamilies", "family-required"]]);
    expect(issues({ fragranceFamilies: undefined })).toEqual([
      ["fragranceFamilies", "family-required"],
    ]);
    expect(issues({ fragranceFamilies: [], packSize: 3 })).toEqual([]);
    expect(
      cmsProductChangeSchema.safeParse({
        ...create,
        action: "update",
        publicId: "01a1652b-6e25-7c03-ae47-25b57131fb06",
        fragranceFamilies: [],
      }).success,
    ).toBe(false);
  });

  it("trims notes and drops empty and repeated ones", () => {
    expect(parse({ notes: [" лимон ", "", "Лимон", "жасмин", "  "] }).data).toMatchObject({
      notes: ["лимон", "жасмин"],
    });
    expect(issues({ notes: ["я".repeat(101)] })[0]?.[0]).toBe("notes.0");
    expect(
      parse({ notes: Array.from({ length: MAX_PRODUCT_NOTES + 1 }, (_, i) => `note ${i}`) })
        .success,
    ).toBe(false);
  });

  it("trims the store code and treats an empty one as none", () => {
    expect(parse({ storeCode: " 3-D " }).data).toMatchObject({ storeCode: "3-D" });
    expect(parse({ storeCode: "" }).data).toMatchObject({ storeCode: null });
    expect(parse({ storeCode: "x".repeat(21) }).success).toBe(false);
  });
});

describe("cmsProductChangeSchema: popular position (#67)", () => {
  it("is optional, and empty means not on the popular list", () => {
    expect(parse({}).data).toMatchObject({ popularRank: null });
    expect(parse({ popularRank: null }).data).toMatchObject({ popularRank: null });
    expect(parse({ popularRank: 3 }).data).toMatchObject({ popularRank: 3 });
  });

  it("accepts only whole positions from 1", () => {
    for (const popularRank of [0, -1, 1.5, "2", 10_000]) {
      expect(issues({ popularRank })[0]?.[0]).toBe("popularRank");
    }
  });
});
