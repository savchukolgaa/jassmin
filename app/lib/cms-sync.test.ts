import { describe, expect, it } from "vitest";
import { cmsProductChangeSchema, MAX_PRODUCT_DESCRIPTION, MAX_PRODUCT_NOTES } from "./cms-sync";

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

describe("cmsProductChangeSchema: slug (#83)", () => {
  it("refuses a slug that is a UUID, whatever its case", () => {
    const uuid = "01a1652b-6e25-7c03-ae47-25b57131fb06";
    expect(issues({ slug: uuid })).toEqual([["slug", "uuid-slug"]]);
    expect(issues({ slug: uuid.toUpperCase() })).toEqual([["slug", "uuid-slug"]]);
  });

  it("accepts a slug that only ends in part of a UUID, as backfilled slugs do", () => {
    expect(issues({ slug: "sauvage-eau-de-toilette-31d4a20a" })).toEqual([]);
    expect(issues({ slug: "light-blue-01a1652b-6e25-7c03-ae47-25b57131fb06" })).toEqual([]);
  });
});

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

describe("cmsProductChangeSchema: descriptions (#100)", () => {
  it("are optional, trimmed, and empty means none", () => {
    expect(parse({}).data).toMatchObject({ description: null, descriptionEn: null });
    expect(parse({ description: "  ", descriptionEn: null }).data).toMatchObject({
      description: null,
      descriptionEn: null,
    });
    const descriptionEn = "A floral scent.\n\nFor day.";
    expect(parse({ description: " Квітковий аромат. ", descriptionEn }).data).toMatchObject({
      description: "Квітковий аромат.",
      descriptionEn,
    });
  });

  it("refuses a description over the limit in either language", () => {
    const long = "а".repeat(MAX_PRODUCT_DESCRIPTION + 1);
    expect(parse({ description: "а".repeat(MAX_PRODUCT_DESCRIPTION) }).success).toBe(true);
    expect(issues({ description: long })[0]?.[0]).toBe("description");
    expect(issues({ descriptionEn: long })[0]?.[0]).toBe("descriptionEn");
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

describe("cmsProductChangeSchema: image size and formats (#88)", () => {
  const formats = [{ url: "/uploads/small_p.jpg", width: 400, height: 500 }];

  it("is optional, so a Strapi from before #88 still syncs", () => {
    expect(parse({}).data).toMatchObject({
      imageWidth: null,
      imageHeight: null,
      imageFormats: null,
    });
  });

  it("accepts the size and the resized formats", () => {
    expect(parse({ imageWidth: 800, imageHeight: 1000, imageFormats: formats }).data).toMatchObject(
      { imageWidth: 800, imageHeight: 1000, imageFormats: formats },
    );
    expect(parse({ imageFormats: [] }).data).toMatchObject({ imageFormats: [] });
  });

  it("refuses odd sizes, unsafe URLs and too many formats", () => {
    for (const imageWidth of [0, -1, 1.5, "800"]) {
      expect(issues({ imageWidth })[0]?.[0]).toBe("imageWidth");
    }
    expect(issues({ imageFormats: [{ ...formats[0], url: "javascript:x" }] })[0]).toEqual([
      "imageFormats.0.url",
      "image-url",
    ]);
    expect(issues({ imageFormats: [{ url: "/uploads/a.jpg", width: 400 }] })[0]?.[0]).toBe(
      "imageFormats.0.height",
    );
    expect(issues({ imageFormats: Array(9).fill(formats[0]) })[0]?.[0]).toBe("imageFormats");
  });
});
