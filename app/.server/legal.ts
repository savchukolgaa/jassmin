// The seller's details for the legal pages (#190), from the Strapi site settings.
import type { SiteSettings } from "~/lib/cms";
import { DEFAULT_LOCALE, type Locale } from "~/lib/i18n";
import type { SellerDetails } from "~/lib/legal";
import { getSiteSettings } from "./cms/content";

export interface SellerDetailsDeps {
  load: (locale: Locale) => Promise<SiteSettings>;
}

const defaultDeps: SellerDetailsDeps = { load: getSiteSettings };

function toSellerDetails(settings: SiteSettings): SellerDetails {
  return {
    legalName: settings.legalName,
    taxId: settings.taxId,
    legalAddress: settings.legalAddress,
    registrationNote: settings.registrationNote,
    phone: settings.phone || null,
    email: settings.email || null,
  };
}

/**
 * The seller's details in `locale`. The address and registration note are localized in Strapi; when
 * the owner filled only the Ukrainian ones, the other locale shows those rather than nothing. A CMS
 * error loading the locale itself is thrown; one loading the Ukrainian fallback is ignored.
 */
export async function getSellerDetails(
  locale: Locale,
  deps: SellerDetailsDeps = defaultDeps,
): Promise<SellerDetails> {
  const details = toSellerDetails(await deps.load(locale));
  if (locale === DEFAULT_LOCALE || (details.legalAddress && details.registrationNote)) {
    return details;
  }
  const fallback = await deps.load(DEFAULT_LOCALE).catch(() => null);
  return {
    ...details,
    legalAddress: details.legalAddress ?? fallback?.legalAddress ?? null,
    registrationNote: details.registrationNote ?? fallback?.registrationNote ?? null,
  };
}
