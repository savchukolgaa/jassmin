import type { ShouldRevalidateFunctionArgs } from "react-router";
import { getLocale } from "~/.server/locale";
import { getPopularPage, getTrioFamilies } from "~/.server/services/products";
import { ErrorContent } from "~/components/layout/ErrorContent";
import { PopularPage } from "~/features/popular/PopularPage";
import { fragranceFamilyLabel } from "~/lib/catalog";
import { createTranslator, metaTranslator, useT } from "~/lib/i18n";
import { type PopularPageView, parsePopularPage, popularHref } from "~/lib/popular";
import { describeRouteError } from "~/lib/route-error";
import { parseTrioSearch } from "~/lib/trio";
import type { Route } from "./+types/popular";

export function meta({ loaderData, matches }: Route.MetaArgs) {
  const { t } = metaTranslator(matches);
  const title = t("meta.title", { page: t("popular.metaTitle") });
  const description = t("popular.metaDescription");
  return [
    { title },
    { name: "description", content: description },
    { property: "og:type", content: "website" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    ...(loaderData
      ? [
          { property: "og:url", content: loaderData.canonicalUrl },
          { tagName: "link", rel: "canonical", href: loaderData.canonicalUrl },
        ]
      : []),
  ];
}

// The staff-ranked perfumes topped up from the bestsellers (#67), from PostgreSQL only. `family`
// params come from the trio builder's "Show my trio": known families only, at most three, in the
// order they were picked. Family filters aren't canonical; pages after the first are.
export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const [locale, knownFamilies] = await Promise.all([getLocale(request), getTrioFamilies()]);
  const families = parseTrioSearch(url.searchParams, knownFamilies);
  const page = await getPopularPage(families, parsePopularPage(url.searchParams));
  const translator = createTranslator(locale);
  const view: PopularPageView = {
    ...page,
    families: families.map((value) => ({ value, label: fragranceFamilyLabel(value, translator) })),
  };
  return { ...view, canonicalUrl: new URL(popularHref([], page.page), url).toString() };
}

// Adding a card to the cart doesn't change the list, so skip re-ranking (the layout still
// refreshes the cart count).
export function shouldRevalidate({
  formMethod,
  formAction,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  if (formMethod?.toUpperCase() === "POST" && formAction === "/cart") {
    return false;
  }
  return defaultShouldRevalidate;
}

export default function Popular({ loaderData }: Route.ComponentProps) {
  return <PopularPage view={loaderData} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const { t } = useT();
  return <ErrorContent {...describeRouteError(error, t)} />;
}
