import type { HomePage, SiteSettings } from "./cms";

// What the home route's loader returns: CMS content prepared for rendering (sanitized HTML,
// validated URLs, SEO fields). Built on the server by `buildHomePageView`.

/** Meta description when the CMS content has none (or failed to load). */
export const DEFAULT_HOME_DESCRIPTION = "Jassmin perfume store";

export interface HomePageView {
  hero: HomePage["hero"];
  about: {
    title: string;
    /** Sanitized HTML rendered from the Strapi Markdown; safe for `dangerouslySetInnerHTML`. */
    bodyHtml: string;
  };
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
    description: string;
    image: string | null;
  };
}
