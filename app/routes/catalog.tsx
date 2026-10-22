import { data } from "react-router";
import { PagePlaceholder } from "~/components/layout/PagePlaceholder";
import type { Route } from "./+types/catalog";

const TITLES = { men: "Men Perfumes", women: "Women Perfumes" } as const;

type CatalogGender = keyof typeof TITLES;

function isCatalogGender(value: string): value is CatalogGender {
  return Object.hasOwn(TITLES, value);
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData ? `${TITLES[loaderData.gender]} — Jassmin` : "Jassmin" }];
}

// Placeholder until the real catalog (#8).
export function loader({ params }: Route.LoaderArgs) {
  if (!isCatalogGender(params.gender)) {
    throw data(null, { status: 404 });
  }
  return { gender: params.gender };
}

export default function Catalog({ loaderData }: Route.ComponentProps) {
  return <PagePlaceholder title={TITLES[loaderData.gender]} />;
}
