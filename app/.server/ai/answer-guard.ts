import type { Locale } from "~/lib/i18n";
import type { AliasMap } from "./catalog-tools";
import { foldLatin } from "./synonyms";

// What the model writes is checked before anyone sees it (#162). Product cards come only from
// aliases the tools handed out, and the prose loses every sentence that could name a perfume the
// customer can't buy: in the feasibility test the model invented "Aquarius" and "Blue Marlin".
// The guard is strict on purpose (owner's choice): a false alarm costs one sentence, and a generic
// text fills a field that ends up empty.

export const MAX_PICKS = 4;
export const MAX_INTRO = 600;
export const MAX_REASON = 240;
export const MAX_QUESTION = 200;

export interface ModelPick {
  id: string;
  reason: string;
}

export interface SelectedPick {
  publicId: string;
  reason: string;
}

/** The picks whose ids the tools handed out in this reply, without duplicates, at most 4. */
export function selectPicks(picks: readonly ModelPick[], aliases: AliasMap): SelectedPick[] {
  const selected: SelectedPick[] = [];
  const seen = new Set<string>();
  for (const pick of picks) {
    const publicId = aliases.publicIdFor(pick.id);
    if (!publicId || seen.has(publicId)) {
      continue;
    }
    seen.add(publicId);
    selected.push({ publicId, reason: pick.reason });
    if (selected.length === MAX_PICKS) {
      break;
    }
  }
  return selected;
}

/** Sentences, each with its closing punctuation. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

/** `text` cut to `max` characters, at a sentence end when there is one, else at a word. */
export function limitLength(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  const head = trimmed.slice(0, max);
  const sentenceEnd = Math.max(
    head.lastIndexOf(". "),
    head.lastIndexOf("! "),
    head.lastIndexOf("? "),
  );
  if (sentenceEnd >= max / 2) {
    return head.slice(0, sentenceEnd + 1);
  }
  const space = head.lastIndexOf(" ", max - 1);
  return `${head.slice(0, space > 0 ? space : max - 1).replace(/[\s,;:–-]+$/u, "")}…`;
}

export interface GuardContext {
  locale: Locale;
  /** Titles and brands of the picks: the only names the prose may contain. */
  allowedNames: readonly string[];
  /** Every catalog title and brand, archived products included. */
  catalogNames: readonly string[];
}

/** Latin words harmless in Ukrainian prose (bottle types, units, the shop's name). */
const LATIN_ALLOWLIST = new Set([
  "edp",
  "edt",
  "edc",
  "eau",
  "de",
  "parfum",
  "toilette",
  "cologne",
  "ml",
  "jassmin",
]);

const ID_PATTERN =
  /\bp\d{1,3}\b|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/iu;
const PRICE_PATTERN =
  /\d[\d\s]*(?:[.,]\d+)?\s?(?:грн|гривень|гривні|гривня|uah|hryvnia|₴)|[₴$€]\s?\d/iu;
const QUOTED_PATTERN = /[«"“„]([^«»"“”„]{2,80})[»"”“]/gu;
const LATIN_WORD = /\p{Script=Latin}[\p{Script=Latin}'’-]{2,}/gu;
const CAPITALIZED = /^\p{Lu}[\p{L}'’-]+$/u;

interface PreparedContext {
  locale: Locale;
  allowed: string[];
  allowedWords: Set<string>;
  /** Folded catalog names that aren't allowed, 3+ characters. */
  forbidden: string[];
}

function prepare(context: GuardContext): PreparedContext {
  const allowed = context.allowedNames.map(foldLatin).filter(Boolean);
  const isAllowed = (name: string) => allowed.some((a) => a === name || a.includes(name));
  return {
    locale: context.locale,
    allowed,
    allowedWords: new Set(allowed.flatMap((name) => name.split(" "))),
    forbidden: [
      ...new Set(context.catalogNames.map(foldLatin).filter((n) => n.length >= 3 && !isAllowed(n))),
    ],
  };
}

function containsName(folded: string, name: string): boolean {
  return ` ${folded} `.includes(` ${name} `);
}

function namesUnknown(sentence: string, context: PreparedContext): boolean {
  const folded = foldLatin(sentence);
  // 1. A catalog title or brand that isn't one of the picks.
  if (context.forbidden.some((name) => containsName(folded, name))) {
    return true;
  }
  // 2. A quoted name that isn't a pick's title or brand.
  for (const match of sentence.matchAll(QUOTED_PATTERN)) {
    const quoted = foldLatin(match[1] ?? "");
    if (quoted && !context.allowed.includes(quoted)) {
      return true;
    }
  }
  // 3. Ukrainian prose: any Latin word that isn't part of a pick's name. Perfume names are Latin,
  // so this catches names the catalog doesn't even have.
  if (context.locale === "uk") {
    for (const match of sentence.matchAll(LATIN_WORD)) {
      const word = foldLatin(match[0]);
      if (!LATIN_ALLOWLIST.has(word) && !context.allowedWords.has(word)) {
        return true;
      }
    }
  }
  // 5. English prose: two or more Capitalized words in a row that aren't a pick's title or brand
  // ("Blue Marlin"). A run that starts the sentence is also tried without its first word, which
  // may just be capitalized ("Try La Vie Est Belle").
  if (context.locale === "en") {
    const words = sentence.split(/\s+/u).map((w) => w.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, ""));
    const known = (run: readonly string[]) =>
      run.length < 2 || context.allowed.some((name) => name.includes(foldLatin(run.join(" "))));
    let run: string[] = [];
    let runStart = 0;
    const runIsUnknown = () =>
      !known(run) && (runStart > 0 || run.length < 3 || !known(run.slice(1)));
    for (const [index, word] of words.entries()) {
      if (CAPITALIZED.test(word)) {
        if (run.length === 0) {
          runStart = index;
        }
        run.push(word);
        continue;
      }
      if (runIsUnknown()) {
        return true;
      }
      run = [];
    }
    if (runIsUnknown()) {
      return true;
    }
  }
  return false;
}

/** 4. An id leaking into the text, or a price (the cards show the prices). */
function leaksIdOrPrice(sentence: string): boolean {
  return ID_PATTERN.test(sentence) || PRICE_PATTERN.test(sentence);
}

export interface CleanedProse {
  text: string;
  /** The sentences that were removed, for the eval and logs. */
  removed: string[];
}

/** `text` without the sentences that name a perfume or brand outside the picks, an id or a price. */
export function cleanProse(text: string, context: GuardContext): CleanedProse {
  const prepared = prepare(context);
  const kept: string[] = [];
  const removed: string[] = [];
  for (const sentence of splitSentences(text)) {
    if (namesUnknown(sentence, prepared) || leaksIdOrPrice(sentence)) {
      removed.push(sentence);
    } else {
      kept.push(sentence);
    }
  }
  return { text: kept.join(" "), removed };
}
