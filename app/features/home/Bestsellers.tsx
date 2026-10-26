import { Link } from "react-router";
import { focusRing } from "~/components/layout/nav";
import { ProductCard } from "~/features/catalog/ProductCard";
import { useT } from "~/lib/i18n";
import type { ProductSummary } from "~/lib/products";

/** The four best-selling perfumes with quick add, and a link to the catalog. */
export function Bestsellers({ products }: { products: ProductSummary[] }) {
  const { t } = useT();
  if (products.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="bestsellers-title" className="reveal">
      <div className="container mx-auto px-4 pt-12 pb-16 md:pb-24">
        <div className="mb-7 flex flex-wrap items-baseline justify-between gap-3">
          <h2
            id="bestsellers-title"
            className="text-4xl leading-tight font-extrabold tracking-[-0.03em] text-ink md:text-5xl"
          >
            {t("home.bestsellers.title")}
          </h2>
          <Link
            to="/catalog/women"
            className={`inline-flex min-h-11 items-center rounded font-extrabold text-ink hover:text-primary-dark ${focusRing("onLight")}`}
          >
            {t("home.bestsellers.viewAll")}
          </Link>
        </div>
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {products.map((product) => (
            <li key={product.id} className="flex">
              <ProductCard product={product} headingLevel={3} variant="compact" />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
