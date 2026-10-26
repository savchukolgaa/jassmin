import type { CmsImage, HomePage, SiteSettings } from "./cms";
import type { Locale } from "./i18n";
import type { ProductSummary } from "./products";
import type { TrioOffer } from "./trio";

/** A fragrance family the trio builder offers: the URL value and what the chip says. */
export interface TrioFamily {
  value: string;
  label: string;
}

/** The shop data the home page shows next to its CMS content (#64). */
export interface HomeShopData {
  /** The live tester-trio offer; `null` hides every price the page would advertise. */
  trioOffer: TrioOffer | null;
  trioFamilies: TrioFamily[];
  /** Families picked in the URL (the trio builder without JS), at most `TRIO_SIZE`. */
  selectedFamilies: string[];
  bestsellers: ProductSummary[];
}

// What the home route's loader returns: CMS content prepared for rendering (sanitized HTML,
// validated URLs, SEO fields). Built on the server by `buildHomePageView`.

export interface HomePageView {
  /** The locale of the home page copy (hero, about, location); `uk` when English was missing. */
  contentLocale: Locale;
  hero: HomePage["hero"];
  about: {
    title: string;
    /** Sanitized HTML rendered from the Strapi Markdown; safe for `dangerouslySetInnerHTML`. */
    bodyHtml: string;
    image: CmsImage | null;
  };
  trioOffer: TrioOffer | null;
  trio: { families: TrioFamily[]; selected: string[] };
  bestsellers: ProductSummary[];
  location: {
    address: string;
    openingHours: string | null;
    /** Google Maps embed URL, or `null` when Strapi holds anything else (no map is shown). */
    mapEmbedUrl: string | null;
    directionsUrl: string;
  };
  contacts: SiteSettings;
  seo: {
    title: string;
    /** Empty when the CMS text is; the route's `meta` then uses `home.defaultDescription`. */
    description: string;
    image: string | null;
  };
}
