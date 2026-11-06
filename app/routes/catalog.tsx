import { data, Link, useLocation, useNavigation } from "react-router";
import { trackEvent } from "~/.server/analytics";
import { getLocale } from "~/.server/locale";
import { getCatalogPage } from "~/.server/services/products";
import { JsonLd } from "~/components/JsonLd";
import { Breadcrumbs } from "~/components/layout/Breadcrumbs";
import { ErrorContent } from "~/components/layout/ErrorContent";
import { focusRing } from "~/components/layout/nav";
import { Pagination } from "~/components/ui/Pagination";
import { ProductListProvider } from "~/features/analytics/ProductList";
import { CatalogFilters } from "~/features/catalog/CatalogFilters";
import { ProductCard } from "~/features/catalog/ProductCard";
import { MAX_SEARCH_RESULT_IDS, shouldRevalidateView } from "~/lib/analytics";
import { catalogBreadcrumbs } from "~/lib/breadcrumbs";
import {
  CATALOG_META_DESCRIPTION_KEYS,
  CATALOG_PAGE_SIZE,
  CATALOG_TITLE_KEYS,
  catalogHref,
  hasActiveFilters,
  isCatalogGender,
} from "~/lib/catalog";
import { parseCatalogSearch } from "~/lib/catalog.schema";
import { cn } from "~/lib/cn";
import { metaTranslator, useT } from "~/lib/i18n";
import { paramFromSegment } from "~/lib/paths";
import { describeRouteError } from "~/lib/route-error";
import { errorMeta, seoMeta } from "~/lib/seo";
import { breadcrumbListLd } from "~/lib/structured-data";
import { useSiteUrl } from "~/lib/use-site-url";
import type { Route } from "./+types/catalog";

// Filtered and sorted views point to the unfiltered catalog; its pages are self-canonical (#85).
export function meta({ loaderData, matches, location, error }: Route.MetaArgs) {
  if (error || !loaderData) {
    return errorMeta({ matches, error });
  }
  const { t } = metaTranslator(matches);
  const { gender, search, page } = loaderData;
  const name = t(CATALOG_TITLE_KEYS[gender]);
  const filtered = hasActiveFilters(search);
  return seoMeta(
    { matches, location },
    {
      title: t("meta.title", {
        page: page > 1 && !filtered ? t("meta.paged", { title: name, page }) : name,
      }),
      description: t(CATALOG_META_DESCRIPTION_KEYS[gender]),
      keepParams: filtered ? [] : ["page"],
    },
  );
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  // The segment is in the URL's language (#84): `zhinochi` or `women`.
  const gender = paramFromSegment("catalog", "gender", params.gender, await getLocale(request));
  if (gender === null || !isCatalogGender(gender)) {
    throw data(null, { status: 404 });
  }
  const search = parseCatalogSearch(new URL(request.url).searchParams);
  const page = await getCatalogPage(gender, search);
  // A filtered or sorted catalog is a search (#18). Its id links the results' impressions, clicks
  // and cart adds to it (#129).
  let searchId: string | null = null;
  if (hasActiveFilters(search)) {
    searchId = crypto.randomUUID();
    void trackEvent({ request, context }, "search", {
      properties: {
        search_id: searchId,
        query: null,
        gender,
        fragrance_family: search.fragranceFamily ?? null,
        brand: search.brand ?? null,
        sort: search.sort,
        page: page.page,
        result_count: page.total,
        product_public_ids: page.products
          .slice(0, MAX_SEARCH_RESULT_IDS)
          .map((product) => product.id),
      },
    });
  }
  return { gender, search, searchId, ...page };
}

// Adding to the cart doesn't change the catalog, and reloading would record a second search.
export const shouldRevalidate = shouldRevalidateView;

export default function Catalog({ loaderData }: Route.ComponentProps) {
  const translator = useT();
  const { t } = translator;
  const { gender, search, searchId, products, total, page, pageCount, filterOptions } = loaderData;
  const { pathname } = useLocation();
  const siteUrl = useSiteUrl();
  const breadcrumbs = catalogBreadcrumbs(translator, gender);
  const navigation = useNavigation();
  // Dim the results while a filter, sort or page change of this catalog loads.
  const busy = navigation.state === "loading" && navigation.location.pathname === pathname;

  return (
    <main className="container mx-auto px-4 pt-8 pb-16">
      <JsonLd data={breadcrumbListLd(siteUrl, breadcrumbs)} />
      <Breadcrumbs items={breadcrumbs} />
      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-4xl font-bold leading-tight tracking-[-0.01em] text-ink md:text-5xl">
          {t(CATALOG_TITLE_KEYS[gender])}
        </h1>
        <p className="text-muted">{t("catalog.count", { count: total })}</p>
      </div>

      <div className="mt-6">
        <CatalogFilters pathname={pathname} search={search} options={filterOptions} />
      </div>

      <section
        aria-label={t("catalog.results")}
        aria-busy={busy || undefined}
        className={cn("mt-8 transition-opacity duration-200", busy && "opacity-60")}
      >
        {products.length > 0 ? (
          // A filtered or sorted catalog is a search, linked to its `search` event (#129).
          <ProductListProvider
            listId={searchId ? "search" : "catalog"}
            searchId={searchId}
            page={page}
            pageSize={CATALOG_PAGE_SIZE}
            productIds={products.map((product) => product.id)}
          >
            <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {products.map((product, index) => (
                <li key={product.id} className="flex">
                  <ProductCard product={product} listIndex={index} />
                </li>
              ))}
            </ul>
          </ProductListProvider>
        ) : (
          <div className="rounded-card-lg bg-blush p-8 text-center">
            <p className="text-lg font-bold text-ink">{t("catalog.empty")}</p>
            <Link
              to={pathname}
              className={`mt-2 inline-block rounded-pill font-bold text-primary-dark underline ${focusRing("onLight")}`}
            >
              {t(`catalog.showAll.${gender}` as const)}
            </Link>
          </div>
        )}
      </section>

      <div className="mt-10">
        <Pagination
          page={page}
          pageCount={pageCount}
          hrefForPage={(target) => catalogHref(pathname, search, target)}
        />
      </div>
    </main>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const { t } = useT();
  return <ErrorContent {...describeRouteError(error, t)} />;
}
