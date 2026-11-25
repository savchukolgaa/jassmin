import { getEnv } from "~/.server/env";
import { getSellerDetails } from "~/.server/legal";
import { getLocale } from "~/.server/locale";
import { OfferTerms } from "~/features/legal/OfferTerms";
import { metaTranslator } from "~/lib/i18n";
import type { SellerDetails } from "~/lib/legal";
import { errorMeta, seoMeta } from "~/lib/seo";
import type { Route } from "./+types/offer-terms";

export function meta({ matches, location, error }: Route.MetaArgs) {
  if (error) {
    return errorMeta({ matches, error });
  }
  const { t } = metaTranslator(matches);
  return seoMeta(
    { matches, location },
    {
      title: t("meta.title", { page: t("legal.offer.title") }),
      description: t("legal.offer.description"),
    },
  );
}

// The public offer (#190). The seller's details come from the CMS; like the privacy page, the
// offer stays readable when Strapi is down and renders without them instead of failing with a 503.
// Outside production an empty required detail shows a placeholder; production leaves it out and
// warns at startup (`warnIfSellerDetailsMissing`).
export async function loader({ request }: Route.LoaderArgs): Promise<{
  seller: SellerDetails | null;
  showPlaceholders: boolean;
}> {
  const showPlaceholders = getEnv().NODE_ENV !== "production";
  try {
    return { seller: await getSellerDetails(await getLocale(request)), showPlaceholders };
  } catch (error: unknown) {
    console.error("Loading the seller's details for the public offer failed", error);
    return { seller: null, showPlaceholders };
  }
}

export default function OfferTermsPage({ loaderData }: Route.ComponentProps) {
  return <OfferTerms seller={loaderData.seller} showPlaceholders={loaderData.showPlaceholders} />;
}
