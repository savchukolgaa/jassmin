import { Link } from "react-router";
import { AddToCartForm } from "~/features/cart/AddToCartForm";
import { formatPrice } from "~/lib/money";
import { formatVolume, type ProductSummary } from "~/lib/products";
import { ProductImage } from "./ProductImage";

export function productHref(id: string): string {
  return `/products/${id}`;
}

export function ProductCard({ product }: { product: ProductSummary }) {
  const href = productHref(product.id);

  return (
    <article className="flex flex-col rounded-3xl bg-white p-3 shadow-sm ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-gray-800">
      <Link to={href} tabIndex={-1} aria-hidden="true">
        <ProductImage imageUrl={product.imageUrl} title={product.title} brand={product.brand} />
      </Link>
      <div className="flex flex-1 flex-col gap-1 px-2 pt-4">
        <p className="text-sm font-semibold uppercase tracking-wide text-primary-dark">
          {product.brand}
        </p>
        <h2 className="text-lg font-bold leading-tight">
          <Link to={href} className="hover:underline">
            {product.title}
          </Link>
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">{formatVolume(product)}</p>
        <p className="mt-auto pt-3 text-xl font-extrabold">{formatPrice(product.price)}</p>
      </div>
      <AddToCartForm
        productId={product.id}
        inStock={product.inStock}
        size="sm"
        className="px-2 pt-3"
      />
    </article>
  );
}
