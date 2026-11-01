import { data } from "react-router";
import { listActiveOffers } from "~/.server/cms/content";
import { cmsUnavailable } from "~/.server/cms/errors";
import { getLocale } from "~/.server/locale";
import { blogCacheHeaders } from "~/.server/services/blog";
import { buildOffersPageView, offerProductIds } from "~/.server/services/offers";
import { getProductSummaries } from "~/.server/services/products";
import { ErrorContent } from "~/components/layout/ErrorContent";
import { OffersPage } from "~/features/offers/OffersPage";
import { blogResponseHeaders } from "~/lib/blog";
import { metaTranslator, useT } from "~/lib/i18n";
import { pathFor } from "~/lib/paths";
import { describeRouteError } from "~/lib/route-error";
import { errorMeta, seoMeta } from "~/lib/seo";
import type { Route } from "./+types/offers";

export function meta({ loaderData, matches, location, error }: Route.MetaArgs) {
  if (error) {
    return errorMeta({ matches, error });
  }
  const { t } = metaTranslator(matches);
  const image = loaderData?.hero?.image;
  return seoMeta(
    { matches, location },
    {
      title: t("meta.title", { page: t("offers.metaTitle") }),
      description: t("offers.metaDescription"),
      image: image
        ? { url: image.url, alt: image.alt, width: image.width, height: image.height }
        : null,
    },
  );
}

// Cached like the blog (CMS content in the visitor's language); errors aren't cached.
export function headers({ loaderHeaders }: Route.HeadersArgs) {
  return blogResponseHeaders(loaderHeaders);
}

// The Strapi offers active right now, with their products from the shop's database (#55). Offers
// never change prices: the products are added to the cart at their usual prices. An outage
// becomes a 503.
export async function loader({ request }: Route.LoaderArgs) {
  const locale = await getLocale(request);
  const offers = await listActiveOffers(locale).catch(cmsUnavailable);
  const products = await getProductSummaries(offerProductIds(offers));
  return data(buildOffersPageView(offers, products, locale), {
    headers: blogCacheHeaders(request),
  });
}

export default function Offers({ loaderData }: Route.ComponentProps) {
  return <OffersPage view={loaderData} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const { t } = useT();
  return <ErrorContent {...describeRouteError(error, t)} />;
}
