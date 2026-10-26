// The home page's tester trio (#64): the offer it advertises and the "Build your trio" picker.
// Isomorphic: no server imports.
import { fragranceFamilyLabel } from "./catalog";
import { INTL_LOCALES, type Translator } from "./i18n";
import { POPULAR_PATH, popularHref } from "./popular";

/** How many fragrance families the trio builder takes, one per tester. */
export const TRIO_SIZE = 3;

/** Where "Show my trio" leads: the popular perfumes (#67), narrowed to the chosen families. */
export const TRIO_TARGET_PATH = POPULAR_PATH;

/**
 * The live tester-trio discount rule, as the home page advertises it. `null` when the rule is
 * missing, inactive, outside its dates or used up, so the page never shows a price checkout
 * won't charge.
 */
export interface TrioOffer {
  /** The price of one set, an exact decimal string. */
  price: string;
  /** Units in one set, e.g. 3. */
  setSize: number;
  /** The tester size in ml, when the rule is limited to one. */
  volumeMl: number | null;
}

/**
 * The families picked in a URL's `family` params: known ones only, trimmed, without duplicates,
 * at most `TRIO_SIZE`, in the order they were picked.
 */
export function parseTrioSearch(
  params: URLSearchParams,
  knownFamilies: readonly string[],
): string[] {
  const known = new Set(knownFamilies);
  const picked = new Set<string>();
  for (const raw of params.getAll("family")) {
    const family = raw.trim();
    if (known.has(family)) {
      picked.add(family);
    }
    if (picked.size === TRIO_SIZE) {
      break;
    }
  }
  return [...picked];
}

/**
 * The picks after a chip was checked or unchecked. A fourth family is refused: the shopper has to
 * drop one first.
 */
export function toggleTrioFamily(
  picked: readonly string[],
  family: string,
  checked: boolean,
): string[] {
  if (!checked) {
    return picked.filter((value) => value !== family);
  }
  return picked.length < TRIO_SIZE && !picked.includes(family) ? [...picked, family] : [...picked];
}

/** "Show my trio": `/popular?family=…` with each chosen family. */
export function trioHref(families: readonly string[]): string {
  return popularHref(families);
}

/** A family as the trio builder and the marquee show it: the URL value and its label. */
export interface TrioFamily {
  value: string;
  label: string;
}

/**
 * Stored families (Ukrainian values) with their labels in the UI's language, alphabetical in it,
 * like the catalog filter (#65).
 */
export function labelTrioFamilies(
  values: readonly string[],
  translator: Pick<Translator, "t" | "locale">,
): TrioFamily[] {
  const collator = new Intl.Collator(INTL_LOCALES[translator.locale]);
  return values
    .map((value) => ({ value, label: fragranceFamilyLabel(value, translator) }))
    .sort((a, b) => collator.compare(a.label, b.label));
}
