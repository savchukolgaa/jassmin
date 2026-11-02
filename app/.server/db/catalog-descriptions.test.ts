import { describe, expect, it } from "vitest";
import { CATALOG_PRODUCTS } from "./catalog-data";
import { CATALOG_DESCRIPTIONS } from "./catalog-descriptions";

const LANGUAGES = ["uk", "en"] as const;
const MIN_LENGTH = 150;
const MAX_LENGTH = 600;

const described = CATALOG_PRODUCTS.flatMap((product) => {
  const description = CATALOG_DESCRIPTIONS[product.publicId];
  return description ? [{ product, description }] : [];
});

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

/** Lowercase, with the typographic apostrophe the texts use and the plain one the notes use alike. */
const normalise = (text: string) => text.toLowerCase().replace(/[’']/g, "'");

/**
 * The start of each word of a note, so an inflected form still matches: «ваніль» → «ваніл»
 * (ванілі, ваніллю), «груша» → «груш» (грушею). Words under 4 letters are too short to tell.
 */
function noteStems(note: string): string[] {
  return normalise(note)
    .split(/\s+/)
    .filter((word) => word.length >= 4)
    .map((word) => word.slice(0, Math.min(5, word.length - 1)));
}

describe("CATALOG_DESCRIPTIONS (#100)", () => {
  it("describes every perfume of the catalog, and nothing else", () => {
    const missing = CATALOG_PRODUCTS.filter((p) => !(p.publicId in CATALOG_DESCRIPTIONS));
    expect(missing.map((p) => p.title)).toEqual([]);
    const ids = new Set(CATALOG_PRODUCTS.map((p) => p.publicId));
    expect(Object.keys(CATALOG_DESCRIPTIONS).filter((id) => !ids.has(id))).toEqual([]);
  });

  it("keeps each text to 2-4 sentences of 150-600 characters, trimmed", () => {
    for (const { product, description } of described) {
      for (const language of LANGUAGES) {
        const text = description[language];
        const label = `${product.title} (${language})`;
        expect(text, label).toBe(text.trim());
        expect(text.length, label).toBeGreaterThanOrEqual(MIN_LENGTH);
        expect(text.length, label).toBeLessThanOrEqual(MAX_LENGTH);
        expect(sentences(text).length, label).toBeGreaterThanOrEqual(2);
        expect(sentences(text).length, label).toBeLessThanOrEqual(4);
      }
    }
  });

  it("writes Ukrainian in Cyrillic and English without it", () => {
    for (const { product, description } of described) {
      expect(description.uk, product.title).toMatch(/[а-яіїєґ]/i);
      expect(description.en, product.title).not.toMatch(/[а-яіїєґ]/i);
    }
  });

  it("gives every perfume its own text and its own opening", () => {
    for (const language of LANGUAGES) {
      const texts = described.map(({ description }) => description[language]);
      expect(new Set(texts).size, language).toBe(texts.length);
      const openings = texts.map((text) => sentences(text)[0]);
      expect(new Set(openings).size, language).toBe(openings.length);
    }
  });

  it("invents no facts: no years, perfumers, awards, concentrations or sales claims", () => {
    const forbidden =
      /\b(19|20)\d{2}\b|парфумер|perfumer|нагород|award|бестселер|bestseller|\bED[PT]\b|eau de/i;
    for (const { product, description } of described) {
      for (const language of LANGUAGES) {
        expect(description[language], `${product.title} (${language})`).not.toMatch(forbidden);
      }
    }
  });

  it("mentions at least one of the perfume's notes in Ukrainian", () => {
    for (const { product, description } of described) {
      const text = normalise(description.uk);
      const stems = product.notes.flatMap(noteStems);
      expect(
        stems.some((stem) => text.includes(stem)),
        product.title,
      ).toBe(true);
    }
  });
});
