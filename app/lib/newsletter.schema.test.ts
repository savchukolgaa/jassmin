import { describe, expect, it } from "vitest";
import { cmsNewsletterSendSchema } from "./newsletter.schema";

const product = "01a1652b-6e25-7c03-ae47-25b57131fb06";
const valid = {
  mode: "send",
  slug: "autumn-news",
  content: {
    uk: { subject: " Осінні новинки ", preheader: "", body: "Текст" },
    en: { subject: "", preheader: null, body: "" },
  },
  productPublicIds: [product],
};

function issues(input: unknown): string[] {
  const result = cmsNewsletterSendSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
}

describe("cmsNewsletterSendSchema", () => {
  it("trims the text, treats a blank English version as none and keeps the products", () => {
    expect(cmsNewsletterSendSchema.parse(valid)).toEqual({
      mode: "send",
      content: {
        slug: "autumn-news",
        uk: { subject: "Осінні новинки", preheader: null, body: "Текст" },
        en: null,
        productPublicIds: [product],
      },
    });
    expect(
      cmsNewsletterSendSchema.parse({ ...valid, productPublicIds: undefined }).content
        .productPublicIds,
    ).toEqual([]);
  });

  it("keeps a filled English version and needs its subject and body", () => {
    const en = { subject: "Autumn", preheader: "New", body: "Text" };
    expect(
      cmsNewsletterSendSchema.parse({ ...valid, content: { ...valid.content, en } }).content.en,
    ).toEqual(en);
    expect(
      issues({ ...valid, content: { ...valid.content, en: { subject: "Autumn", body: "" } } }),
    ).toEqual(["content.en.body"]);
  });

  it("refuses a missing subject or body, too-long text and a bad slug", () => {
    expect(issues({ ...valid, content: { uk: { subject: "", body: "" } } })).toEqual([
      "content.uk.subject",
      "content.uk.body",
    ]);
    expect(
      issues({ ...valid, content: { uk: { subject: "x".repeat(151), body: "Текст" } } }),
    ).toEqual(["content.uk.subject"]);
    for (const slug of ["Autumn", "autumn--news", "осінь", "x".repeat(81), ""]) {
      expect(issues({ ...valid, slug })).toEqual(["slug"]);
    }
  });

  it("allows at most four distinct products", () => {
    const ids = Array.from({ length: 5 }, (_, i) => `01a1652b-6e25-7c03-ae47-25b57131fb0${i}`);
    expect(issues({ ...valid, productPublicIds: ids })).toEqual(["productPublicIds"]);
    expect(issues({ ...valid, productPublicIds: [product, product.toUpperCase()] })).toEqual([
      "productPublicIds",
    ]);
    expect(issues({ ...valid, productPublicIds: ["not-a-uuid"] })).toEqual(["productPublicIds.0"]);
  });

  it("needs the staff member's email for a test, and names them by it when Strapi sends no name", () => {
    expect(
      cmsNewsletterSendSchema.parse({ ...valid, mode: "test", testEmail: " Olha@Jassmin.UA " }),
    ).toMatchObject({ mode: "test", to: { email: "olha@jassmin.ua", name: "olha" } });
    expect(
      cmsNewsletterSendSchema.parse({
        ...valid,
        mode: "test",
        testEmail: "olha@jassmin.ua",
        testName: "Ольга",
      }),
    ).toMatchObject({ to: { name: "Ольга" } });
    expect(issues({ ...valid, mode: "test" })).toEqual(["testEmail"]);
    expect(issues({ ...valid, mode: "publish" })).toEqual(["mode"]);
  });
});
