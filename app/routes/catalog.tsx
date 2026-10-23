import { data } from "react-router";
import { getCatalogPage } from "~/.server/services/products";
import { PagePlaceholder } from "~/components/layout/PagePlaceholder";
import { CATALOG_TITLES, isCatalogGender, parseCatalogSearch } from "~/lib/catalog";
import type { Route } from "./+types/catalog";

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData ? `${CATALOG_TITLES[loaderData.gender]} — Jassmin` : "Jassmin" }];
}

export async function loader({ params, request }: Route.LoaderArgs) {
  if (!isCatalogGender(params.gender)) {
    throw data(null, { status: 404 });
  }
  const search = parseCatalogSearch(new URL(request.url).searchParams);
  // #18: trackEvent(request, "search", { properties: search }) when hasActiveFilters(search).
  return { gender: params.gender, search, ...(await getCatalogPage(params.gender, search)) };
}

export default function Catalog({ loaderData }: Route.ComponentProps) {
  return <PagePlaceholder title={`${CATALOG_TITLES[loaderData.gender]} (${loaderData.total})`} />;
}
