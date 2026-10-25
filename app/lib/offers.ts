// View types for the special offers page (#55). Isomorphic: no server imports.

import type { CmsImage, OfferKind } from "./cms";
import type { Locale } from "./i18n/locales";
import type { ProductSummary } from "./products";

export const OFFERS_PATH = "/offers";

/** Order of the card groups on /offers. `perk` offers form the perks strip instead. */
export const OFFER_GROUP_ORDER = [
  "discovery-set",
  "seasonal",
  "gift",
  "bundle",
  "featured",
  "last-units",
] as const satisfies readonly OfferKind[];

export type OfferGroupKind = (typeof OFFER_GROUP_ORDER)[number];

export interface OfferView {
  slug: string;
  kind: OfferKind;
  /** The locale of the offer's copy: `uk` when the English translation was missing. */
  contentLocale: Locale;
  title: string;
  summary: string | null;
  /** Sanitized HTML from the Markdown body. */
  bodyHtml: string | null;
  image: CmsImage | null;
  priceNote: string | null;
  /**
   * When the offer ends, in shop time: the date, plus the time when it doesn't end at midnight.
   * `null` for offers without an end.
   */
  validUntil: { date: string; time: string | null } | null;
  /** An app path; `label` is `null` when the editor left it blank (the UI uses a default). */
  cta: { to: string; label: string | null } | null;
  /** Products in the editor's order; ones that no longer exist are left out. */
  products: ProductSummary[];
}

export interface OfferGroupView {
  kind: OfferGroupKind;
  offers: OfferView[];
}

export interface OffersPageView {
  /** The main campaign: the active non-perk offer that comes first in editor order. */
  hero: OfferView | null;
  perks: OfferView[];
  /** Groups in `OFFER_GROUP_ORDER`, without empty ones. */
  groups: OfferGroupView[];
}

/** No campaign is running: only perks, if anything. */
export function hasNoOffers(view: OffersPageView): boolean {
  return view.hero === null && view.groups.length === 0;
}
