import { ButtonLink } from "~/components/ui/ButtonLink";
import { ProductCard } from "~/features/catalog/ProductCard";
import { CATALOG_TITLE_KEYS, type CatalogGender } from "~/lib/catalog";
import { useT } from "~/lib/i18n";
import type { ProductSummary } from "~/lib/products";

/**
 * In place of the purchase form on an archived product's page (#88): the product can't be
 * ordered anymore, with a way back to its catalog.
 */
export function ProductUnavailable({ catalog }: { catalog: CatalogGender }) {
  const { t } = useT();
  return (
    <div role="status" className="flex flex-col items-start gap-3 rounded-card-lg bg-blush p-6">
      <p className="text-lg font-bold text-ink">{t("product.archived.heading")}</p>
      <p className="text-body">{t("product.archived.text")}</p>
      <ButtonLink to={`/catalog/${catalog}`} size="sm">
        {t("product.archived.catalog")}
        <span className="sr-only">: {t(CATALOG_TITLE_KEYS[catalog])}</span>
      </ButtonLink>
    </div>
  );
}

/** Listed perfumes like an archived one (#88); nothing when there are none. */
export function SimilarProducts({ products }: { products: ProductSummary[] }) {
  const { t } = useT();
  if (products.length === 0) {
    return null;
  }
  return (
    <section aria-labelledby="similar-heading" className="mt-16">
      <h2
        id="similar-heading"
        className="text-3xl font-bold tracking-[-0.01em] text-ink md:text-4xl"
      >
        {t("product.similar")}
      </h2>
      <ul className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {products.map((product) => (
          <li key={product.id} className="flex">
            <ProductCard product={product} headingLevel={3} />
          </li>
        ))}
      </ul>
    </section>
  );
}
