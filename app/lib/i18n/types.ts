import type { uk } from "./uk";

/**
 * A message that depends on a number, picked with `Intl.PluralRules`. Ukrainian needs `one`, `few`
 * and `many` (1 парфум, 2 парфуми, 5 парфумів) and `other` for fractions; English `one` and
 * `other`.
 */
export interface PluralForms {
  one: string;
  few?: string;
  many?: string;
  other: string;
}

type Widen<T> = T extends string
  ? string
  : T extends { other: string }
    ? PluralForms
    : { [K in keyof T]: Widen<T[K]> };

/** The shape every locale's messages must have: the Ukrainian dictionary's. */
export type Dictionary = Widen<typeof uk>;

type Leaves<T, Leaf, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends Leaf
    ? `${Prefix}${K}`
    : T[K] extends string | PluralForms
      ? never
      : Leaves<T[K], Leaf, `${Prefix}${K}.`>;
}[keyof T & string];

/** A dotted path to a plain message, e.g. `"nav.about"`. */
export type TextKey = Leaves<Dictionary, string>;

/** A dotted path to a plural message; `t()` needs a `count` for it. */
export type PluralKey = Leaves<Dictionary, PluralForms>;

export type MessageKey = TextKey | PluralKey;

/** Values for `{name}` placeholders. Numbers are formatted for the locale. */
export type MessageParams = Record<string, string | number>;
