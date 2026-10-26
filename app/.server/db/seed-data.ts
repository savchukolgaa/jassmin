import type { FragranceFamily, PerfumeVolumeMl } from "~/lib/enums";
import type { discounts, products } from "./schema";

export interface SampleVariant {
  volumeMl: PerfumeVolumeMl;
  price: string;
  stockQuantity: number;
}

export type SampleProduct = Omit<typeof products.$inferInsert, "fragranceFamily"> & {
  publicId: string;
  /** Primary first; the seed copies the first into `fragrance_family` (#65). */
  fragranceFamilies: FragranceFamily[];
  /** Sizes for sale. One of them repeats the legacy `volumeMl`/`price`/`stockQuantity`. */
  variants: SampleVariant[];
};

/**
 * Sample catalog for local development (`pnpm db:seed`). Each product has a fixed UUID v7
 * `publicId`, so re-running the seed skips products that already exist. Never change an
 * existing `publicId`; add new products with a fresh one (`select uuidv7()`).
 *
 * The legacy `price`/`volumeMl`/`stockQuantity` columns are deprecated (#26) but still NOT NULL,
 * so each product keeps them, equal to one of its variants (the one the migration backfills).
 */
export const SAMPLE_PRODUCTS: SampleProduct[] = [
  {
    publicId: "01a1652b-6e25-7c03-ae47-25b57131fb06",
    title: "Coco Mademoiselle Eau de Parfum",
    brand: "Chanel",
    gender: "women",
    fragranceFamilies: ["шипрові", "квіткові"],
    notes: ["апельсин", "бергамот", "троянда", "жасмин", "пачулі", "ветивер"],
    description: "Свіжий і чуттєвий аромат з нотами апельсина, троянди, пачулі та ветиверу.",
    price: "6850.00",
    volumeMl: 50,
    stockQuantity: 6,
    variants: [
      { volumeMl: 7, price: "990.00", stockQuantity: 10 },
      { volumeMl: 10, price: "1350.00", stockQuantity: 0 },
      { volumeMl: 30, price: "4450.00", stockQuantity: 3 },
      { volumeMl: 50, price: "6850.00", stockQuantity: 6 },
      { volumeMl: 100, price: "9900.00", stockQuantity: 2 },
    ],
  },
  {
    publicId: "01a1652b-6e25-7c39-a4ce-d1efe1e47081",
    title: "La Vie Est Belle Eau de Parfum",
    brand: "Lancôme",
    gender: "women",
    fragranceFamilies: ["гурманські", "квіткові"],
    notes: ["чорна смородина", "груша", "ірис", "жасмин", "праліне", "ваніль", "пачулі"],
    description: "Солодкий аромат з ірисом, праліне та ваніллю.",
    price: "4790.00",
    volumeMl: 50,
    stockQuantity: 10,
    variants: [
      { volumeMl: 10, price: "950.00", stockQuantity: 8 },
      { volumeMl: 30, price: "3290.00", stockQuantity: 5 },
      { volumeMl: 50, price: "4790.00", stockQuantity: 10 },
      { volumeMl: 100, price: "6890.00", stockQuantity: 0 },
    ],
  },
  {
    publicId: "01a1652b-6e25-7c3f-9567-5f694e414a33",
    title: "J'adore Eau de Parfum",
    brand: "Dior",
    gender: "women",
    fragranceFamilies: ["квіткові", "фруктові"],
    notes: ["груша", "диня", "іланг-іланг", "жасмин", "троянда", "ваніль", "мускус"],
    description: "Розкішний букет з жасмину, троянди та іланг-ілангу.",
    price: "5990.00",
    volumeMl: 50,
    stockQuantity: 4,
    variants: [
      { volumeMl: 7, price: "890.00", stockQuantity: 6 },
      { volumeMl: 50, price: "5990.00", stockQuantity: 4 },
      { volumeMl: 100, price: "8650.00", stockQuantity: 1 },
    ],
  },
  {
    publicId: "01a1652b-6e25-7c44-8d5b-bce46a20ad83",
    title: "Sauvage Eau de Toilette",
    brand: "Dior",
    gender: "men",
    fragranceFamilies: ["фужерні", "пряні", "свіжі"],
    notes: ["бергамот", "перець", "лаванда", "ветивер", "амброксан"],
    description: "Свіжий пряний аромат з бергамотом, перцем і амброксаном.",
    price: "4450.00",
    volumeMl: 100,
    stockQuantity: 12,
    variants: [
      { volumeMl: 10, price: "790.00", stockQuantity: 15 },
      { volumeMl: 50, price: "3290.00", stockQuantity: 6 },
      { volumeMl: 100, price: "4450.00", stockQuantity: 12 },
    ],
  },
  {
    publicId: "01a1652b-6e25-7c48-8efe-b797385135f1",
    title: "Bleu de Chanel Eau de Parfum",
    brand: "Chanel",
    gender: "men",
    fragranceFamilies: ["деревні", "ароматичні", "цитрусові"],
    notes: ["грейпфрут", "лимон", "мʼята", "імбир", "ладан", "сандал", "кедр"],
    description: "Деревно-ароматичний аромат з грейпфрутом, ладаном і сандалом.",
    price: "6290.00",
    volumeMl: 100,
    stockQuantity: 5,
    variants: [
      { volumeMl: 10, price: "1090.00", stockQuantity: 4 },
      { volumeMl: 50, price: "4590.00", stockQuantity: 3 },
      { volumeMl: 100, price: "6290.00", stockQuantity: 5 },
    ],
  },
  {
    publicId: "01a1652b-6e25-7c4c-90c3-90721a76a8ea",
    title: "Acqua di Giò Eau de Toilette",
    brand: "Giorgio Armani",
    gender: "men",
    fragranceFamilies: ["водяні", "цитрусові", "ароматичні"],
    notes: ["морські ноти", "бергамот", "неролі", "розмарин", "пачулі"],
    description: "Морська свіжість з нотами цитрусів, розмарину та пачулі.",
    price: "3890.00",
    volumeMl: 100,
    stockQuantity: 0,
    variants: [
      { volumeMl: 30, price: "1990.00", stockQuantity: 0 },
      { volumeMl: 100, price: "3890.00", stockQuantity: 0 },
    ],
  },
  {
    publicId: "01a1652b-6e25-7c51-bcf8-0d0dd7accc0a",
    title: "Wood Sage & Sea Salt Cologne",
    brand: "Jo Malone London",
    gender: "unisex",
    fragranceFamilies: ["деревні", "ароматичні"],
    notes: ["амбретта", "морська сіль", "шавлія", "водорості"],
    description: "Мінеральний аромат морської солі та шавлії.",
    price: "5350.00",
    volumeMl: 100,
    stockQuantity: 3,
    variants: [
      { volumeMl: 7, price: "690.00", stockQuantity: 12 },
      { volumeMl: 30, price: "2690.00", stockQuantity: 2 },
      { volumeMl: 100, price: "5350.00", stockQuantity: 3 },
    ],
  },
  {
    publicId: "01a1652b-6e25-7c55-8003-478f2d6abfb1",
    title: "Molecule 01 Eau de Toilette",
    brand: "Escentric Molecules",
    gender: "unisex",
    fragranceFamilies: ["деревні", "мускусні"],
    notes: ["ізо-E-супер"],
    description: "Мінімалістичний аромат на основі однієї молекули ізо-E-супер.",
    price: "4200.00",
    volumeMl: 100,
    stockQuantity: 7,
    variants: [
      { volumeMl: 7, price: "590.00", stockQuantity: 20 },
      { volumeMl: 10, price: "790.00", stockQuantity: 15 },
      { volumeMl: 30, price: "1890.00", stockQuantity: 4 },
      { volumeMl: 50, price: "2890.00", stockQuantity: 0 },
      { volumeMl: 100, price: "4200.00", stockQuantity: 7 },
    ],
  },
  {
    publicId: "01a1652b-6e25-7c59-9e70-834bee97963a",
    title: "Набір тестерів 3 × 10 мл",
    brand: "Jassmin",
    gender: "unisex",
    // A set of different perfumes: no family of its own (#65).
    fragranceFamilies: [],
    description: "Три тестери по 10 мл, щоб спробувати аромати перед покупкою повного флакона.",
    price: "990.00",
    volumeMl: 10,
    packSize: 3,
    stockQuantity: 20,
    variants: [{ volumeMl: 10, price: "990.00", stockQuantity: 20 }],
  },
];

export type SampleDiscount = typeof discounts.$inferInsert;

/**
 * Discount rules for local development (#59), matched by `slug`, so re-running the seed skips the
 * ones that exist. The tester trio is the shop's one automatic offer; the codes exercise every
 * case on the cart page.
 */
export const SAMPLE_DISCOUNTS: SampleDiscount[] = [
  {
    // Any three single 10 ml sizes for 499 ₴, up to three sets per order. `pack_size 1` keeps
    // the 3 × 10 ml tester set product out of it.
    slug: "tester-trio",
    kind: "fixed_price_set",
    value: "499.00",
    scopeVolumesMl: [10],
    scopePackSize: 1,
    minQuantity: 3,
    maxSets: 3,
  },
  { slug: "welcome-10", code: "JASSMIN10", kind: "percent", value: "10.00" },
  {
    slug: "expired-5",
    code: "EXPIRED5",
    kind: "percent",
    value: "5.00",
    startsAt: new Date("2025-01-01T00:00:00+02:00"),
    endsAt: new Date("2025-02-01T00:00:00+02:00"),
  },
  {
    slug: "used-up",
    code: "USEDUP",
    kind: "fixed_amount",
    value: "100.00",
    maxRedemptions: 1,
    redemptionCount: 1,
  },
];
