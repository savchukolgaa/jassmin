import type { ReactNode } from "react";
import { ProductListProvider } from "~/features/analytics/ProductList";
import { ProductCard } from "~/features/catalog/ProductCard";
import type { ListId } from "~/lib/analytics";
import { cn } from "~/lib/cn";
import type { ProductSummary } from "~/lib/products";

type RecommendedProductsProps = {
  /** The section's `id` prefix, so several lists on a page get their own heading ids. */
  id: string;
  title: string;
  subtitle?: ReactNode;
  /** The list the cards' impressions, clicks and cart adds are recorded in (#129, #182). */
  listId: ListId;
  products: ProductSummary[];
  className?: string;
};

/**
 * A row of product cards with quick add and the volume picker (#74): the recommendations (#182)
 * and the similar perfumes (#88). Nothing when there are no products.
 */
export function RecommendedProducts({
  id,
  title,
  subtitle,
  listId,
  products,
  className,
}: RecommendedProductsProps) {
  if (products.length === 0) {
    return null;
  }
  const headingId = `${id}-heading`;
  return (
    <section aria-labelledby={headingId} className={cn("mt-16", className)}>
      <h2 id={headingId} className="text-3xl font-bold tracking-[-0.01em] text-ink md:text-4xl">
        {title}
      </h2>
      {subtitle ? <p className="mt-2 text-body">{subtitle}</p> : null}
      <ProductListProvider listId={listId} productIds={products.map((product) => product.id)}>
        <ul className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {products.map((product, index) => (
            <li key={product.id} className="flex">
              <ProductCard product={product} headingLevel={3} listIndex={index} />
            </li>
          ))}
        </ul>
      </ProductListProvider>
    </section>
  );
}
