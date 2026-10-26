import { ButtonLink } from "~/components/ui/ButtonLink";
import { Pagination } from "~/components/ui/Pagination";
import { ProductCard } from "~/features/catalog/ProductCard";
import { useT } from "~/lib/i18n";
import { type PopularPageView, popularHref } from "~/lib/popular";
import { PopularEmpty } from "./PopularEmpty";
import { PopularHero } from "./PopularHero";

/**
 * /popular (#67, PopularPlus): the band, a page of compact cards with quick add and the pages,
 * then a way into both catalogs. The empty state replaces the cards and that panel.
 */
export function PopularPage({ view }: { view: PopularPageView }) {
  const { t } = useT();
  const familyValues = view.families.map((family) => family.value);

  return (
    <main>
      <PopularHero families={view.families} />
      <div className="container mx-auto flex flex-col gap-10 px-4 pt-12 pb-16 md:pb-20">
        {view.products.length === 0 ? (
          <PopularEmpty filtered={view.families.length > 0} />
        ) : (
          <>
            <div className="flex flex-col gap-5">
              <p className="text-sm font-bold text-muted">
                {t("catalog.count", { count: view.total })}
              </p>
              <ul
                aria-label={t("popular.list")}
                className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4"
              >
                {view.products.map((product) => (
                  <li key={product.id} className="flex">
                    <ProductCard product={product} headingLevel={2} variant="compact" />
                  </li>
                ))}
              </ul>
            </div>
            <Pagination
              page={view.page}
              pageCount={view.pageCount}
              hrefForPage={(page) => popularHref(familyValues, page)}
            />
            <section
              aria-labelledby="popular-more"
              className="reveal flex flex-wrap items-center justify-between gap-5 rounded-card-lg bg-blush p-7 md:p-12"
            >
              <div className="flex min-w-0 flex-[1_1_20rem] flex-col gap-2">
                <h2
                  id="popular-more"
                  className="text-3xl font-extrabold tracking-[-0.03em] text-ink md:text-4xl"
                >
                  {t("popular.more.heading")}
                </h2>
                <p className="text-lg text-body">{t("popular.more.text")}</p>
              </div>
              <div className="flex flex-wrap gap-3">
                <ButtonLink to="/catalog/women">{t("popular.women")}</ButtonLink>
                <ButtonLink to="/catalog/men" variant="dark">
                  {t("popular.men")}
                </ButtonLink>
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
