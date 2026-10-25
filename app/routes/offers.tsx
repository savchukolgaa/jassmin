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
import { OFFERS_PATH } from "~/lib/offers";
import { describeRouteError } from "~/lib/route-error";
import type { Route } from "./+types/offers";

export function meta({ loaderData, matches }: Route.MetaArgs) {
  const { t } = metaTranslator(matches);
  const title = t("meta.title", { page: t("offers.metaTitle") });
  const description = t("offers.metaDescription");
  return [
    { title },
    { name: "description", content: description },
    { property: "og:type", content: "website" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    ...(loaderData?.hero?.image
      ? [{ property: "og:image", content: loaderData.hero.image.url }]
      : []),
    ...(loaderData
      ? [
          { property: "og:url", content: loaderData.canonicalUrl },
          { tagName: "link", rel: "canonical", href: loaderData.canonicalUrl },
        ]
      : []),
  ];
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
  return data(
    {
      ...buildOffersPageView(offers, products, locale),
      canonicalUrl: new URL(OFFERS_PATH, request.url).toString(),
    },
    { headers: blogCacheHeaders(request) },
  );
}

export default function Offers({ loaderData }: Route.ComponentProps) {
  return <OffersPage view={loaderData} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const { t } = useT();
  return <ErrorContent {...describeRouteError(error, t)} />;
}
