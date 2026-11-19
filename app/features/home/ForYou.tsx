import { RecommendedProducts } from "~/features/recommendations/RecommendedProducts";
import { useT } from "~/lib/i18n";
import type { ProductSummary } from "~/lib/products";

/**
 * "For you" (#182): perfumes recommended from what the visitor viewed and bought, above the
 * bestsellers. Nothing for a visitor without history.
 */
export function ForYou({ products }: { products: ProductSummary[] | null }) {
  const { t } = useT();
  if (!products || products.length === 0) {
    return null;
  }
  return (
    <div className="container mx-auto px-4 pt-4">
      <RecommendedProducts
        id="for-you"
        title={t("recommendations.forYou.title")}
        subtitle={t("recommendations.forYou.subtitle")}
        listId="recs_for_you"
        products={products}
        className="mt-12"
      />
    </div>
  );
}
