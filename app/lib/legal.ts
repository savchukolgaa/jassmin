// The legal pages (#190): the public offer, delivery and payment, and returns. Their version dates,
// the return rule's deadline and the seller's details from the Strapi site settings. Isomorphic: no
// server imports. See docs/legal.md before changing the text or a date.

/**
 * The public offer's version (`YYYY-MM-DD`): shown on the page and stored on every new order as
 * `orders.offer_version`, so bump it whenever the offer's text changes.
 */
export const OFFER_UPDATED_AT = "2026-11-25";

/** The returns page's version (`YYYY-MM-DD`); bump it when its text changes. */
export const RETURNS_UPDATED_AT = "2026-11-25";

/** The delivery and payment page's version (`YYYY-MM-DD`), the sitemap's `lastmod`. */
export const DELIVERY_UPDATED_AT = "2026-11-25";

/** Days from receipt to report a defective, damaged or wrong item. */
export const RETURN_REPORT_DAYS = 14;

/** The seller (a ФОП) as the offer names them; `null` until the owner fills a field in Strapi. */
export interface SellerDetails {
  /** The ФОП's full name. */
  legalName: string | null;
  /** РНОКПП, the 10-digit tax number. */
  taxId: string | null;
  /** The registration address, in the page's language (or Ukrainian when not translated). */
  legalAddress: string | null;
  /** Optional, e.g. the date and number of the ФОП's registration. */
  registrationNote: string | null;
  phone: string | null;
  email: string | null;
}

/** The details the offer can't do without; `registrationNote` is optional. */
export const REQUIRED_SELLER_FIELDS = [
  "legalName",
  "taxId",
  "legalAddress",
  "phone",
  "email",
] as const satisfies readonly (keyof SellerDetails)[];

export type RequiredSellerField = (typeof REQUIRED_SELLER_FIELDS)[number];

/** The required details that are empty, in `REQUIRED_SELLER_FIELDS` order. */
export function missingSellerDetails(details: SellerDetails): RequiredSellerField[] {
  return REQUIRED_SELLER_FIELDS.filter((field) => !details[field]?.trim());
}
