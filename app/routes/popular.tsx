import type { ShouldRevalidateFunctionArgs } from "react-router";
import { getLocale } from "~/.server/locale";
import { getPopularPage, getTrioFamilies } from "~/.server/services/products";
import { ErrorContent } from "~/components/layout/ErrorContent";
import { PopularPage } from "~/features/popular/PopularPage";
import { fragranceFamilyLabel } from "~/lib/catalog";
import { createTranslator, metaTranslator, useT } from "~/lib/i18n";
import { pageOf } from "~/lib/paths";
import type { PopularPageView } from "~/lib/popular";
import { parsePopularPage } from "~/lib/popular.schema";
import { describeRouteError } from "~/lib/route-error";
import { errorMeta, seoMeta } from "~/lib/seo";
import { parseTrioGender, parseTrioSearch } from "~/lib/trio";
import type { Route } from "./+types/popular";

// Gender and family filters (from the trio builder) point to the unfiltered list; its pages are
// self-canonical (#85).
export function meta({ loaderData, matches, location, error }: Route.MetaArgs) {
  if (error) {
    return errorMeta({ matches, error });
  }
  const { t } = metaTranslator(matches);
  const name = t("popular.metaTitle");
  const page = loaderData?.page ?? 1;
  return seoMeta(
    { matches, location },
    {
      title: t("meta.title", { page: page > 1 ? t("meta.paged", { title: name, page }) : name }),
      description: t("popular.metaDescription"),
      keepParams: ["page"],
    },
  );
}

// The staff-ranked perfumes topped up from the bestsellers (#67), from PostgreSQL only. `gender`
// and `family` params come from the trio builder's "Show my trio": `women` or `men` (anything else
// is ignored, #102), and known families only, at most three, in the order they were picked.
export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const [locale, knownFamilies] = await Promise.all([getLocale(request), getTrioFamilies()]);
  const families = parseTrioSearch(url.searchParams, knownFamilies);
  const gender = parseTrioGender(url.searchParams);
  const page = await getPopularPage({ families, gender }, parsePopularPage(url.searchParams));
  const translator = createTranslator(locale);
  const view: PopularPageView = {
    ...page,
    families: families.map((value) => ({ value, label: fragranceFamilyLabel(value, translator) })),
    gender,
  };
  return view;
}

// Adding a card to the cart doesn't change the list, so skip re-ranking (the layout still
// refreshes the cart count).
export function shouldRevalidate({
  formMethod,
  formAction,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  if (formMethod?.toUpperCase() === "POST" && pageOf(formAction) === "cart") {
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
