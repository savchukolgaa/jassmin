// The seller's details for the legal pages (#190), from the Strapi site settings, and the startup
// check that warns production when the owner hasn't filled them in.
import type { SiteSettings } from "~/lib/cms";
import { DEFAULT_LOCALE, type Locale } from "~/lib/i18n";
import { missingSellerDetails, type SellerDetails } from "~/lib/legal";
import { getSiteSettings } from "./cms/content";
import { getEnv } from "./env";

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

export interface SellerCheckDeps {
  env: { NODE_ENV: string };
  load: (locale: Locale) => Promise<SiteSettings>;
  warn: (message: string) => void;
}

let checked = false;

/**
 * Once, in production only, when the server starts: logs which required seller details are empty
 * in the Ukrainian site settings (the English page falls back to them), since the public offer then
 * leaves them out. Never throws; when Strapi can't be reached it says so instead. Runs in the
 * background, so start-up doesn't wait for Strapi.
 */
export async function warnIfSellerDetailsMissing(deps?: Partial<SellerCheckDeps>): Promise<void> {
  const env = deps?.env ?? getEnv();
  if (checked || env.NODE_ENV !== "production") return;
  checked = true;
  const warn = deps?.warn ?? console.warn;
  try {
    const details = toSellerDetails(await (deps?.load ?? getSiteSettings)(DEFAULT_LOCALE));
    const missing = missingSellerDetails(details);
    if (missing.length > 0) {
      warn(
        `[legal] Seller details missing in the Strapi site settings: ${missing.join(", ")}. ` +
          "The public offer leaves them out; fill them in (see docs/legal.md).",
      );
    }
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    warn(
      `[legal] Couldn't check the seller's details in the Strapi site settings: ${reason} (see docs/legal.md)`,
    );
  }
}

/** Lets a test run the startup check again. */
export function resetSellerCheckForTests(): void {
  checked = false;
}
