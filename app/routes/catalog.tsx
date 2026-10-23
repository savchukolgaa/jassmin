import { data, Link, useLocation, useNavigation } from "react-router";
import { getCatalogPage } from "~/.server/services/products";
import { ErrorContent } from "~/components/layout/ErrorContent";
import { CatalogFilters } from "~/features/catalog/CatalogFilters";
import { Pagination } from "~/features/catalog/Pagination";
import { ProductCard } from "~/features/catalog/ProductCard";
import { CATALOG_TITLES, isCatalogGender, parseCatalogSearch } from "~/lib/catalog";
import { cn } from "~/lib/cn";
import { describeRouteError } from "~/lib/route-error";
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
  const { gender, search, products, total, page, pageCount, filterOptions } = loaderData;
  const { pathname } = useLocation();
  const navigation = useNavigation();
  // Dim the results while a filter, sort or page change of this catalog loads.
  const busy = navigation.state === "loading" && navigation.location.pathname === pathname;

  return (
    <main className="container mx-auto px-4 pt-10 pb-16">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-4xl font-extrabold tracking-tight">{CATALOG_TITLES[gender]}</h1>
        <p className="text-gray-600 dark:text-gray-400">
          {total === 1 ? "1 perfume" : `${total} perfumes`}
        </p>
      </div>

      <div className="mt-6">
        <CatalogFilters pathname={pathname} search={search} options={filterOptions} />
      </div>

      <section
        aria-label="Perfumes"
        aria-busy={busy || undefined}
        className={cn("mt-8 transition-opacity duration-200", busy && "opacity-60")}
      >
        {products.length > 0 ? (
          <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {products.map((product) => (
              <li key={product.id} className="flex">
                <ProductCard product={product} />
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-3xl bg-primary-light/10 p-8 text-center">
            <p className="text-lg font-semibold">No perfumes match these filters.</p>
            <Link
              to={pathname}
              className="mt-2 inline-block font-semibold text-primary-dark underline"
            >
              Show all {CATALOG_TITLES[gender].toLowerCase()}
            </Link>
          </div>
        )}
      </section>

      <div className="mt-10">
        <Pagination pathname={pathname} search={search} page={page} pageCount={pageCount} />
      </div>
    </main>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <ErrorContent {...describeRouteError(error)} />;
}
