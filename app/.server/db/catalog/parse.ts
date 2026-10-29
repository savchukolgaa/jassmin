// Turns the owner's perfume list (#66) into catalog entries. The list is Markdown: a
// `**Womens perfume**` and a `**Mens perfume**` section, with one line per perfume:
//   - **3-D** | **D&G Light Blue** | Dolce & Gabbana | Квіткові, фруктові | Дзвіночок, лимон, …
// A line may end with `(popular)`, and a title may carry `(Unisex)`.
import { createHash } from "node:crypto";
import { type FragranceFamily, type Gender, isFragranceFamily } from "~/lib/enums";

export const CATALOG_LISTS = ["women", "men"] as const;

/** Which of the owner's lists a perfume is in; unisex perfumes come from both. */
export type CatalogList = (typeof CATALOG_LISTS)[number];

export interface CatalogEntry {
  /** Derived from the list, the code and the title as written, see `catalogPublicId`. */
  publicId: string;
  list: CatalogList;
  /** The code on the bottle; not unique (the lists reuse codes, and `11-L` is two perfumes). */
  storeCode: string;
  title: string;
  brand: string;
  gender: Gender;
  /** Primary first. */
  fragranceFamilies: FragranceFamily[];
  notes: string[];
  /**
   * Position on `/popular` (`products.popular_rank`, #67) for the perfumes the owner marked
   * `(popular)`: 1, 2, … in the order of the list, women first; `null` for the rest.
   */
  popularRank: number | null;
}

/** An owner-approved correction to one line, found by its list, code and title as written. */
export interface EntryFix {
  list: CatalogList;
  storeCode: string;
  sourceTitle: string;
  title?: string;
  brand?: string;
}

export interface CatalogFixes {
  entries: readonly EntryFix[];
  /** Lower-case family as written → the family it means. */
  familyAliases: Readonly<Record<string, FragranceFamily>>;
  /** Lower-case note as written → its spelling. */
  noteSpelling: Readonly<Record<string, string>>;
}

export class CatalogParseError extends Error {
  override name = "CatalogParseError";
}

const HEADINGS: Record<string, CatalogList> = {
  "**womens perfume**": "women",
  "**mens perfume**": "men",
};

const UNISEX = /\s*\(unisex\)\s*/i;
const POPULAR = /\s*\(popular\)\s*$/i;
const LATIN = /[a-z]/i;
const CYRILLIC = /[Ѐ-ӿ]/;

// Fixed, so every conversion derives the same ids.
const ID_NAMESPACE = "jassmin-catalog#66";

/**
 * The product's `public_id`: a name-based UUID (version 8, from SHA-256) of the list, the code and
 * the title **as written in the owner's list**. It never changes when a fix renames the perfume or
 * staff edit it in Strapi, so the import finds the product again; two perfumes sharing a code get
 * different ids through their titles.
 */
export function catalogPublicId(list: CatalogList, storeCode: string, sourceTitle: string): string {
  const bytes = createHash("sha256")
    .update(`${ID_NAMESPACE}\n${list}\n${storeCode}\n${sourceTitle}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x80;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const collapse = (text: string) => text.replace(/\s+/g, " ").trim();
const lower = (text: string) => collapse(text).toLocaleLowerCase("uk");

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

/** Splits, lower-cases, aliases and de-duplicates the families; throws on an unknown one. */
export function normalizeFamilies(
  raw: string,
  aliases: CatalogFixes["familyAliases"],
): FragranceFamily[] {
  const families = unique(
    raw
      .split(",")
      .map(lower)
      .filter(Boolean)
      .map((family) => aliases[family] ?? family),
  );
  if (families.length === 0) {
    throw new Error("no fragrance family");
  }
  return families.map((family) => {
    if (!isFragranceFamily(family)) {
      throw new Error(`unknown fragrance family "${family}"`);
    }
    return family;
  });
}

/** Splits, lower-cases, respells and de-duplicates the notes. */
export function normalizeNotes(raw: string, spelling: CatalogFixes["noteSpelling"]): string[] {
  const notes = unique(
    raw
      .split(",")
      .map(lower)
      .filter(Boolean)
      .map((note) => spelling[note] ?? note),
  );
  if (notes.length === 0) {
    throw new Error("no notes");
  }
  return notes;
}

/** A word mixing Latin and Cyrillic letters, e.g. `Bvlgarі` with a Cyrillic `і`. */
function mixedScriptWord(text: string): string | undefined {
  return text.split(/\s+/).find((word) => LATIN.test(word) && CYRILLIC.test(word));
}

const stripBold = (field: string) => field.replace(/^\*\*(.*)\*\*$/, "$1").trim();

const fixKey = (list: CatalogList, storeCode: string, sourceTitle: string) =>
  `${list}\n${storeCode}\n${sourceTitle}`;

/**
 * Parses the owner's list and applies the fixes. Throws a `CatalogParseError` naming the line for
 * anything it can't read (a line outside the format, an unknown family, a mixed-script word), for
 * two lines with the same id, and for a fix whose line isn't in the list.
 */
export function parseCatalogMarkdown(text: string, fixes: CatalogFixes): CatalogEntry[] {
  const pending = new Map(
    fixes.entries.map((fix) => [fixKey(fix.list, fix.storeCode, fix.sourceTitle), fix]),
  );
  const ids = new Set<string>();
  const entries: CatalogEntry[] = [];
  let popularCount = 0;
  let list: CatalogList | undefined;

  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    const fail = (reason: string): never => {
      throw new CatalogParseError(`Line ${index + 1}: ${reason}: ${line}`);
    };
    const heading = HEADINGS[line.toLowerCase()];
    if (heading) {
      list = heading;
      continue;
    }
    // Text before the first section is the owner's note to us.
    if (!line || !list) continue;
    if (!line.startsWith("- ")) fail("not a perfume line");

    const fields = line
      .slice(2)
      .split("|")
      .map((field) => field.trim());
    if (fields.length !== 5) fail(`expected 5 fields separated by "|", found ${fields.length}`);
    const [rawCode = "", rawTitle = "", rawBrand = "", rawFamilies = "", rawNotes = ""] = fields;
    const storeCode = stripBold(rawCode);
    const sourceTitle = collapse(stripBold(rawTitle));
    if (!storeCode || !sourceTitle || !rawBrand) fail("missing code, title or brand");

    const unisex = UNISEX.test(sourceTitle);
    const key = fixKey(list, storeCode, sourceTitle);
    const fix = pending.get(key);
    pending.delete(key);
    const title = fix?.title ?? collapse(sourceTitle.replace(UNISEX, " "));
    const brand = fix?.brand ?? collapse(rawBrand);
    const mixed = mixedScriptWord(`${title} ${brand}`);
    if (mixed) fail(`"${mixed}" mixes Latin and Cyrillic letters`);

    let fragranceFamilies: FragranceFamily[] = [];
    let notes: string[] = [];
    try {
      fragranceFamilies = normalizeFamilies(rawFamilies, fixes.familyAliases);
      notes = normalizeNotes(rawNotes.replace(POPULAR, ""), fixes.noteSpelling);
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }

    const publicId = catalogPublicId(list, storeCode, sourceTitle);
    if (ids.has(publicId)) fail(`"${sourceTitle}" (${storeCode}) is listed twice`);
    ids.add(publicId);
    const popularRank = POPULAR.test(rawNotes) ? ++popularCount : null;
    entries.push({
      publicId,
      list,
      storeCode,
      title,
      brand,
      gender: unisex ? "unisex" : list,
      fragranceFamilies,
      notes,
      popularRank,
    });
  }

  const unused = [...pending.values()].map(
    (fix) => `${fix.list} ${fix.storeCode} "${fix.sourceTitle}"`,
  );
  if (unused.length > 0) {
    throw new CatalogParseError(`Fixes for lines that aren't in the list: ${unused.join(", ")}`);
  }
  return entries;
}
