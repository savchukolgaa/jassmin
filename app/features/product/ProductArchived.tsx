import { ButtonLink } from "~/components/ui/ButtonLink";
import { RecommendedProducts } from "~/features/recommendations/RecommendedProducts";
import { CATALOG_TITLE_KEYS, type CatalogGender } from "~/lib/catalog";
import { usePathFor, useT } from "~/lib/i18n";
import type { ProductSummary } from "~/lib/products";
import type { ProductRecsSource } from "~/lib/recommendations";

/**
 * In place of the purchase form on an archived product's page (#88): the product can't be
 * ordered anymore, with a way back to its catalog.
 */
export function ProductUnavailable({ catalog }: { catalog: CatalogGender }) {
  const { t } = useT();
  const path = usePathFor();
  return (
    <div role="status" className="flex flex-col items-start gap-3 rounded-card-lg bg-blush p-6">
      <p className="text-lg font-bold text-ink">{t("product.archived.heading")}</p>
      <p className="text-body">{t("product.archived.text")}</p>
      <ButtonLink to={path("catalog", { gender: catalog })} size="sm">
        {t("product.archived.catalog")}
        <span className="sr-only">: {t(CATALOG_TITLE_KEYS[catalog])}</span>
      </ButtonLink>
    </div>
  );
}

/**
 * A product page's suggestions (#88, #182): "Customers also chose" from the nightly
 * recommendations, or the family-based similar perfumes while the product has too few signals.
 * Nothing when there are none.
 */
export function SimilarProducts({
  products,
  source = "similar",
}: {
  products: ProductSummary[];
  source?: ProductRecsSource;
}) {
  const { t } = useT();
  return source === "recs" ? (
    <RecommendedProducts
      id="recs-product"
      title={t("recommendations.product.title")}
      listId="recs_product"
      products={products}
    />
  ) : (
    <RecommendedProducts
      id="similar"
      title={t("product.similar")}
      listId="similar"
      products={products}
    />
  );
}
