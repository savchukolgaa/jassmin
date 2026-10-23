import { data } from "react-router";
import { PagePlaceholder } from "~/components/layout/PagePlaceholder";
import { CATALOG_TITLES, isCatalogGender } from "~/lib/catalog";
import type { Route } from "./+types/catalog";

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData ? `${CATALOG_TITLES[loaderData.gender]} — Jassmin` : "Jassmin" }];
}

// Placeholder until the real catalog (#8).
export function loader({ params }: Route.LoaderArgs) {
  if (!isCatalogGender(params.gender)) {
    throw data(null, { status: 404 });
  }
  return { gender: params.gender };
}

export default function Catalog({ loaderData }: Route.ComponentProps) {
  return <PagePlaceholder title={CATALOG_TITLES[loaderData.gender]} />;
}
