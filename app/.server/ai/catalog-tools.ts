import { z } from "zod";
import { FRAGRANCE_FAMILIES, type Gender } from "~/lib/enums";
import type { PerfumerProductRow } from "../db/queries/perfumer";
import {
  type SearchPerfumesArgs,
  type SimilarToArgs,
  searchPerfumesArgsSchema,
  similarToArgsSchema,
} from "./catalog-tools.schema";
import type { ToolDefinition } from "./client";
import { foldLatin, normalize, resolveFamilies, resolveNotes } from "./synonyms";

// The perfumer's read-only catalog tools (#162). The model never sees a `public_id`: every product
// a tool returns gets a short per-reply alias (`p1`, `p2`, …), and only those aliases can become
// picks, so a product the tools didn't return can never become a card.

export const DEFAULT_LIMIT = 6;
const NOTES_SHOWN = 5;

/** Maps the reply's aliases (`p1`, …) to products and back. */
export class AliasMap {
  private readonly byAlias = new Map<string, string>();
  private readonly byPublicId = new Map<string, string>();

  aliasFor(publicId: string): string {
    let alias = this.byPublicId.get(publicId);
    if (!alias) {
      alias = `p${this.byAlias.size + 1}`;
      this.byAlias.set(alias, publicId);
      this.byPublicId.set(publicId, alias);
    }
    return alias;
  }

  /** The `public_id` behind an alias the tools handed out, or `undefined`. */
  publicIdFor(alias: string): string | undefined {
    return this.byAlias.get(alias.trim().toLowerCase());
  }

  get size(): number {
    return this.byAlias.size;
  }
}

/** Which criteria the results matched: notes, families only (fallback), or none were given. */
export type SearchMatch = "notes" | "families" | "nothing" | "any";

export interface SearchResult {
  match: SearchMatch;
  products: PerfumerProductRow[];
}

const GENDER_SCOPE: Record<"women" | "men", readonly Gender[]> = {
  women: ["women", "unisex"],
  men: ["men", "unisex"],
};

/** Whole kopiyky, so a budget compares exactly. */
function kopiyky(price: string | number): number {
  return Math.round(Number(price) * 100);
}

/** Active products in the gender scope with their sizes in stock and within the budget. */
function available(
  products: readonly PerfumerProductRow[],
  { gender, maxPrice }: { gender?: "women" | "men"; maxPrice?: number },
): PerfumerProductRow[] {
  const genders = gender ? GENDER_SCOPE[gender] : undefined;
  const budget = maxPrice === undefined ? undefined : kopiyky(maxPrice);
  return products.flatMap((product) => {
    if (!product.active || (genders && !genders.includes(product.gender))) {
      return [];
    }
    const sizes =
      budget === undefined
        ? product.sizes
        : product.sizes.filter((size) => kopiyky(size.price) <= budget);
    return sizes.length ? [{ ...product, sizes }] : [];
  });
}

function countFamilies(product: PerfumerProductRow, families: readonly string[]): number {
  return families.filter((family) => product.fragranceFamilies.includes(family)).length;
}

/** Notes match by substring either way ("кедр" finds "білий кедр"), ignoring case. */
function countNotes(product: PerfumerProductRow, notes: readonly string[]): number {
  const own = product.notes.map(normalize);
  return notes.filter((note) =>
    own.some((mine) => mine.includes(note) || (mine.length >= 4 && note.includes(mine))),
  ).length;
}

/** Staff's popular order first (nulls last), then the title, so results are stable. */
function byPopularity(a: PerfumerProductRow, b: PerfumerProductRow): number {
  const rank =
    (a.popularRank ?? Number.MAX_SAFE_INTEGER) - (b.popularRank ?? Number.MAX_SAFE_INTEGER);
  return rank || a.title.localeCompare(b.title);
}

interface Criteria {
  gender?: "women" | "men";
  families: readonly string[];
  notes: readonly string[];
  maxPrice?: number;
  limit: number;
  exclude?: string;
}

function rank(products: readonly PerfumerProductRow[], criteria: Criteria): SearchResult {
  const pool = available(products, criteria).filter((p) => p.publicId !== criteria.exclude);
  const scored = pool.map((product) => ({
    product,
    notes: countNotes(product, criteria.notes),
    families: countFamilies(product, criteria.families),
  }));

  let match: SearchMatch;
  let hits: typeof scored;
  if (criteria.notes.length === 0 && criteria.families.length === 0) {
    match = "any";
    hits = scored;
  } else if (scored.some((s) => s.notes > 0)) {
    match = "notes";
    hits = scored.filter((s) => s.notes > 0 || s.families > 0);
  } else if (scored.some((s) => s.families > 0)) {
    // The notes matched nothing (or none were asked for): fall back to the families.
    match = "families";
    hits = scored.filter((s) => s.families > 0);
  } else {
    return { match: "nothing", products: [] };
  }

  hits.sort(
    (a, b) =>
      b.notes * 2 + b.families - (a.notes * 2 + a.families) || byPopularity(a.product, b.product),
  );
  return { match, products: hits.slice(0, criteria.limit).map((s) => s.product) };
}

/** `search_perfumes`: available products by gender, families, notes and budget. */
export function searchCatalog(
  products: readonly PerfumerProductRow[],
  args: SearchPerfumesArgs,
): SearchResult {
  const notes = resolveNotes(args.notes ?? []);
  return rank(products, {
    gender: args.gender,
    families: [...new Set([...resolveFamilies(args.families ?? []), ...notes.families])],
    notes: notes.notes,
    maxPrice: args.max_price_uah,
    limit: args.limit ?? DEFAULT_LIMIT,
  });
}

/**
 * The product a customer means by `title` ("La Vie Est Belle", "lancome la vie est belle"), active
 * or not: the exact title, then "brand title", then a title the query starts with or contains,
 * then a title that contains the query. Active products win ties.
 */
export function findByTitle(
  products: readonly PerfumerProductRow[],
  title: string,
): PerfumerProductRow | undefined {
  const query = foldLatin(title);
  if (query.length < 2) {
    return undefined;
  }
  const scoreOf = (product: PerfumerProductRow): number => {
    const own = foldLatin(product.title);
    const full = foldLatin(`${product.brand} ${product.title}`);
    const fullReversed = foldLatin(`${product.title} ${product.brand}`);
    if (own === query || full === query || fullReversed === query) return 4;
    if (query.includes(own) && own.length >= 3) return 3 + own.length / 1000;
    if (own.startsWith(query)) return 2;
    if (own.includes(query) && query.length >= 3) return 1;
    return 0;
  };
  let best: { product: PerfumerProductRow; score: number } | undefined;
  for (const product of products) {
    const score = scoreOf(product) + (product.active ? 0.0001 : 0);
    if (score >= 1 && (!best || score > best.score)) {
      best = { product, score };
    }
  }
  return best?.product;
}

export interface SimilarResult extends SearchResult {
  reference: PerfumerProductRow | undefined;
}

/** `similar_to`: products sharing the reference perfume's families and notes. */
export function similarInCatalog(
  products: readonly PerfumerProductRow[],
  args: SimilarToArgs,
): SimilarResult {
  const reference = findByTitle(products, args.title);
  if (!reference) {
    return { reference, match: "nothing", products: [] };
  }
  const gender = args.gender ?? (reference.gender === "unisex" ? undefined : reference.gender);
  return {
    reference,
    ...rank(products, {
      gender,
      families: reference.fragranceFamilies,
      notes: reference.notes.map(normalize),
      maxPrice: args.max_price_uah,
      limit: args.limit ?? DEFAULT_LIMIT,
      exclude: reference.publicId,
    }),
  };
}

/** A compact row for the model: alias, names, families, a few notes and the sizes in budget. */
function toRow(product: PerfumerProductRow, aliases: AliasMap) {
  return {
    id: aliases.aliasFor(product.publicId),
    title: product.title,
    brand: product.brand,
    gender: product.gender,
    families: product.fragranceFamilies,
    notes: product.notes.slice(0, NOTES_SHOWN),
    sizes: product.sizes.map((size) => ({
      ml: size.ml,
      price_uah: Number(size.price),
    })),
  };
}

const MATCH_HINTS: Record<SearchMatch, string> = {
  notes: "Matched by notes and families.",
  families: "No perfume has these notes; these match the families instead.",
  nothing: "Nothing in the catalog matches. Say so and ask about other families or notes.",
  any: "No families or notes were given; these are the shop's popular perfumes.",
};

export const SEARCH_PERFUMES = "search_perfumes";
export const SIMILAR_TO = "similar_to";

const genderParameter = {
  type: "string",
  enum: ["women", "men"],
  description: "Who the perfume is for. Leave it out when it doesn't matter.",
};

const maxPriceParameter = {
  type: "number",
  description: "The most the customer wants to pay, in UAH, for one bottle.",
};

const limitParameter = {
  type: "integer",
  minimum: 1,
  maximum: 8,
  description: `How many perfumes to return (default ${DEFAULT_LIMIT}).`,
};

export const CATALOG_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: SEARCH_PERFUMES,
    description:
      "Search the shop's catalog for perfumes in stock. Returns perfumes with an `id`, title, brand, families, notes and sizes with prices. Recommend only perfumes this tool or similar_to returned.",
    parameters: {
      type: "object",
      properties: {
        gender: genderParameter,
        families: {
          type: "array",
          items: { type: "string" },
          description: `Fragrance families, in Ukrainian: ${FRAGRANCE_FAMILIES.join(", ")}.`,
        },
        notes: {
          type: "array",
          items: { type: "string" },
          description: "Scent notes in Ukrainian, e.g. жасмин, ваніль, бергамот, сандал, троянда.",
        },
        max_price_uah: maxPriceParameter,
        limit: limitParameter,
      },
    },
  },
  {
    name: SIMILAR_TO,
    description:
      "Find perfumes in the catalog similar to a perfume the customer names (by its title), by shared families and notes.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "The perfume's name, e.g. La Vie Est Belle." },
        gender: genderParameter,
        max_price_uah: maxPriceParameter,
        limit: limitParameter,
      },
      required: ["title"],
    },
  },
];

/** What one tool call did, for the eval script and logs. */
export interface ToolCallRecord {
  name: string;
  /** The parsed arguments, or the raw JSON when they were invalid. */
  arguments: unknown;
  ok: boolean;
  match?: SearchMatch;
  /** Aliases of the products returned. */
  resultIds: string[];
}

export interface ToolRun {
  /** The tool message for the model (JSON). */
  content: string;
  record: ToolCallRecord;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return undefined;
  }
}

function failure(name: string, raw: unknown, error: string): ToolRun {
  return {
    content: JSON.stringify({ error }),
    record: { name, arguments: raw, ok: false, resultIds: [] },
  };
}

/** Runs one tool call against the catalog `products`. Never throws for a model's mistake. */
export function runCatalogTool(
  products: readonly PerfumerProductRow[],
  name: string,
  rawArguments: string,
  aliases: AliasMap,
): ToolRun {
  const raw = parseJson(rawArguments);
  if (raw === undefined) {
    return failure(name, rawArguments, "The arguments are not valid JSON.");
  }

  if (name === SEARCH_PERFUMES) {
    const args = searchPerfumesArgsSchema.safeParse(raw);
    if (!args.success) {
      return failure(name, raw, `Invalid arguments: ${z.prettifyError(args.error)}`);
    }
    const result = searchCatalog(products, args.data);
    const rows = result.products.map((product) => toRow(product, aliases));
    return {
      content: JSON.stringify({ match: MATCH_HINTS[result.match], perfumes: rows }),
      record: {
        name,
        arguments: args.data,
        ok: true,
        match: result.match,
        resultIds: rows.map((row) => row.id),
      },
    };
  }

  if (name === SIMILAR_TO) {
    const args = similarToArgsSchema.safeParse(raw);
    if (!args.success) {
      return failure(name, raw, `Invalid arguments: ${z.prettifyError(args.error)}`);
    }
    const result = similarInCatalog(products, args.data);
    const rows = result.products.map((product) => toRow(product, aliases));
    const reference = result.reference
      ? {
          title: result.reference.title,
          brand: result.reference.brand,
          families: result.reference.fragranceFamilies,
          notes: result.reference.notes.slice(0, NOTES_SHOWN),
        }
      : null;
    return {
      content: JSON.stringify(
        reference
          ? { reference, match: MATCH_HINTS[result.match], perfumes: rows }
          : {
              reference: null,
              perfumes: [],
              hint: "This perfume isn't in the catalog. Ask which notes or families the customer likes in it, then use search_perfumes.",
            },
      ),
      record: {
        name,
        arguments: args.data,
        ok: true,
        match: result.match,
        resultIds: rows.map((row) => row.id),
      },
    };
  }

  return failure(name, raw, `Unknown tool "${name}". Use ${SEARCH_PERFUMES} or ${SIMILAR_TO}.`);
}
