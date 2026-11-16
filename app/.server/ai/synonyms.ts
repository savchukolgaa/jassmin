import { FRAGRANCE_FAMILIES, type FragranceFamily, isFragranceFamily } from "~/lib/enums";

// The perfumer's search is forgiving (#162): models ask for "морська вода" as a note, "свіжі" as a
// note, or a family by synonym or in English. These maps turn what they ask for into the catalog's
// own vocabulary: the 16 `FRAGRANCE_FAMILIES` and the Ukrainian notes in `products.notes`.

/** Lowercase, NFKC, one kind of apostrophe, `ё` → `е`, single spaces. */
export function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’ʼ`]/g, "'")
    .replaceAll("ё", "е")
    .replace(/\s+/g, " ")
    .trim();
}

/** Lowercase without accents, for matching Latin titles and brands ("Lancome" = "Lancôme"). */
export function foldLatin(value: string): string {
  return normalize(value)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const F = (...families: FragranceFamily[]) => families;

/**
 * Words that mean one or more families, in Ukrainian and English. Keys are normalized. Each
 * family's own name and its English name are added below.
 */
const FAMILY_SYNONYMS: Record<string, FragranceFamily[]> = {
  // водяні
  морські: F("водяні"),
  морський: F("водяні"),
  морська: F("водяні"),
  морське: F("водяні"),
  "морська вода": F("водяні"),
  "морські ноти": F("водяні"),
  море: F("водяні"),
  океан: F("водяні"),
  водні: F("водяні"),
  водяний: F("водяні"),
  акватичні: F("водяні"),
  aquatic: F("водяні"),
  marine: F("водяні"),
  oceanic: F("водяні"),
  ocean: F("водяні"),
  sea: F("водяні"),
  "sea notes": F("водяні"),
  ozonic: F("водяні"),
  // свіжі / цитрусові
  свіжий: F("свіжі", "цитрусові"),
  свіжа: F("свіжі", "цитрусові"),
  свіже: F("свіжі", "цитрусові"),
  свіжість: F("свіжі", "цитрусові"),
  fresh: F("свіжі", "цитрусові"),
  цитрус: F("цитрусові"),
  цитрусовий: F("цитрусові"),
  citrus: F("цитрусові"),
  citrusy: F("цитрусові"),
  // гурманські / ванільні
  солодкі: F("гурманські", "ванільні"),
  солодкий: F("гурманські", "ванільні"),
  солодка: F("гурманські", "ванільні"),
  солодке: F("гурманські", "ванільні"),
  sweet: F("гурманські", "ванільні"),
  десертні: F("гурманські"),
  гурман: F("гурманські"),
  gourmand: F("гурманські"),
  ванільний: F("ванільні"),
  vanilla: F("ванільні"),
  // східні / пряні
  орієнтальні: F("східні"),
  орієнтальний: F("східні"),
  східний: F("східні"),
  амброві: F("східні"),
  oriental: F("східні"),
  amber: F("східні"),
  ambery: F("східні"),
  "spicy oriental": F("пряні", "східні"),
  "пряні східні": F("пряні", "східні"),
  "східні пряні": F("пряні", "східні"),
  пряний: F("пряні"),
  гострі: F("пряні"),
  спеції: F("пряні"),
  spicy: F("пряні"),
  spice: F("пряні"),
  // квіткові / фруктові
  квітковий: F("квіткові"),
  квіти: F("квіткові"),
  floral: F("квіткові"),
  flowery: F("квіткові"),
  flowers: F("квіткові"),
  фруктовий: F("фруктові"),
  фрукти: F("фруктові"),
  ягідні: F("фруктові"),
  fruity: F("фруктові"),
  fruit: F("фруктові"),
  berry: F("фруктові"),
  // деревні / шипрові / мускусні
  деревний: F("деревні"),
  дерево: F("деревні"),
  woody: F("деревні"),
  wood: F("деревні"),
  шипр: F("шипрові"),
  chypre: F("шипрові"),
  мускус: F("мускусні"),
  musky: F("мускусні"),
  musk: F("мускусні"),
  // зелені / ароматичні / фужерні / альдегідні
  зелений: F("зелені"),
  "трав'яні": F("зелені", "ароматичні"),
  green: F("зелені"),
  herbal: F("зелені", "ароматичні"),
  aromatic: F("ароматичні"),
  фужер: F("фужерні"),
  fougere: F("фужерні"),
  fougère: F("фужерні"),
  aldehydic: F("альдегідні"),
  aldehyde: F("альдегідні"),
  альдегіди: F("альдегідні"),
  // Moods that models pass as a family.
  літні: F("свіжі", "цитрусові", "водяні"),
  summer: F("свіжі", "цитрусові", "водяні"),
  зимові: F("східні", "гурманські", "пряні"),
  winter: F("східні", "гурманські", "пряні"),
  теплі: F("східні", "ванільні", "деревні"),
  warm: F("східні", "ванільні", "деревні"),
};

/** The English names of the families (the catalog labels in `en.ts`), as synonyms. */
const ENGLISH_FAMILY_NAMES: Record<FragranceFamily, string> = {
  квіткові: "floral",
  фруктові: "fruity",
  східні: "oriental",
  водяні: "aquatic",
  шипрові: "chypre",
  деревні: "woody",
  мускусні: "musky",
  пряні: "spicy",
  гурманські: "gourmand",
  зелені: "green",
  ванільні: "vanilla",
  ароматичні: "aromatic",
  альдегідні: "aldehydic",
  цитрусові: "citrus",
  свіжі: "fresh",
  фужерні: "fougère",
};

const familyLookup = new Map<string, FragranceFamily[]>();
for (const family of FRAGRANCE_FAMILIES) {
  familyLookup.set(family, [family]);
  familyLookup.set(normalize(ENGLISH_FAMILY_NAMES[family]), [family]);
}
for (const [word, families] of Object.entries(FAMILY_SYNONYMS)) {
  familyLookup.set(normalize(word), families);
}

/** A family whose name starts like `word` ("квітков…" → квіткові), for Ukrainian inflections. */
function familyByStem(word: string): FragranceFamily | undefined {
  if (word.length < 5) {
    return undefined;
  }
  const stem = word.slice(0, Math.max(5, word.length - 2));
  return FRAGRANCE_FAMILIES.find((family) => family.startsWith(stem));
}

/** The families one word or phrase means, or `[]` when it means none. */
export function familiesFor(value: string): FragranceFamily[] {
  const word = normalize(value);
  if (isFragranceFamily(word)) {
    return [word];
  }
  const known = familyLookup.get(word) ?? familyLookup.get(word.replace(/ (notes|ноти)$/, ""));
  if (known) {
    return known;
  }
  const byStem = familyByStem(word);
  return byStem ? [byStem] : [];
}

function unique<T>(values: Iterable<T>): T[] {
  return [...new Set(values)];
}

/** The catalog families for what a model asked for; words that mean no family are ignored. */
export function resolveFamilies(values: readonly string[]): FragranceFamily[] {
  return unique(values.flatMap(familiesFor));
}

/**
 * Note synonyms: the catalog's own variants (`роза` / `троянда` both appear) and English names of
 * the most common notes in `catalog-data.ts`. Each maps to every spelling worth matching.
 */
const NOTE_SYNONYMS: Record<string, string[]> = {
  роза: ["троянда", "роза"],
  троянда: ["троянда", "роза"],
  rose: ["троянда", "роза"],
  musk: ["мускус"],
  jasmine: ["жасмин"],
  bergamot: ["бергамот"],
  sandalwood: ["сандал"],
  сандалове: ["сандал"],
  cedar: ["кедр"],
  cedarwood: ["кедр"],
  vanilla: ["ваніль"],
  ванільні: ["ваніль"],
  amber: ["амбра"],
  ambergris: ["амбра"],
  mandarin: ["мандарин"],
  tangerine: ["мандарин"],
  patchouli: ["пачулі"],
  lemon: ["лимон"],
  violet: ["фіалка"],
  orange: ["апельсин"],
  grapefruit: ["грейпфрут"],
  vetiver: ["ветивер"],
  blackcurrant: ["чорна смородина"],
  "black currant": ["чорна смородина"],
  смородина: ["смородина"],
  pepper: ["перець"],
  "pink pepper": ["рожевий перець"],
  apple: ["яблуко"],
  peony: ["півонія"],
  lavender: ["лаванда"],
  iris: ["ірис"],
  peach: ["персик"],
  raspberry: ["малина"],
  mint: ["м'ята"],
  мята: ["м'ята"],
  cinnamon: ["кориця"],
  gardenia: ["гарденія"],
  freesia: ["фрезія"],
  magnolia: ["магнолія"],
  "orange blossom": ["апельсиновий цвіт"],
  neroli: ["неролі", "апельсиновий цвіт"],
  pineapple: ["ананас"],
  ginger: ["імбир"],
  sage: ["шавлія"],
  plum: ["слива"],
  "lily of the valley": ["конвалія"],
  "oak moss": ["дубовий мох"],
  oakmoss: ["дубовий мох"],
  tonka: ["боби тонка", "тонка"],
  "tonka bean": ["боби тонка", "тонка"],
  coffee: ["кава"],
  oud: ["уд"],
  leather: ["шкіра"],
  tobacco: ["тютюн"],
  caramel: ["карамель"],
  honey: ["мед"],
  coconut: ["кокос"],
  tuberose: ["тубероза"],
  pear: ["груша"],
  incense: ["ладан"],
  cardamom: ["кардамон"],
};

const noteLookup = new Map<string, string[]>(
  Object.entries(NOTE_SYNONYMS).map(([word, notes]) => [normalize(word), notes.map(normalize)]),
);

export interface ResolvedNotes {
  /** Normalized note spellings to look for (substring) in `products.notes`. */
  notes: string[];
  /** Families the "notes" really meant ("морська вода", "свіжі"). */
  families: FragranceFamily[];
}

/**
 * Splits what a model passed as notes into real notes and families. A word that is a family or a
 * family synonym ("свіжі", "морська вода") counts as a family and as a note to look for, since a
 * few products list such words among their notes too.
 */
export function resolveNotes(values: readonly string[]): ResolvedNotes {
  const notes: string[] = [];
  const families: FragranceFamily[] = [];
  for (const value of values) {
    const word = normalize(value);
    if (!word) {
      continue;
    }
    const synonyms = noteLookup.get(word);
    if (synonyms) {
      notes.push(...synonyms);
      continue;
    }
    notes.push(word);
    families.push(...familiesFor(word));
  }
  return { notes: unique(notes), families: unique(families) };
}
