import { Link } from "react-router";
import { focusRing } from "~/components/layout/nav";
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
    <article className="lift flex w-full flex-col rounded-card bg-white p-3 ring-1 ring-line">
      <Link to={href} tabIndex={-1} aria-hidden="true">
        <ProductImage imageUrl={product.imageUrl} title={product.title} brand={product.brand} />
      </Link>
      <div className="flex flex-1 flex-col gap-1 px-2 pt-4">
        <p className="text-sm font-bold uppercase tracking-wide text-primary-dark">
          {product.brand}
        </p>
        <h2 className="text-xl font-extrabold leading-tight tracking-[-0.03em] text-ink">
          <Link to={href} className={`rounded hover:underline ${focusRing("onLight")}`}>
            {product.title}
          </Link>
        </h2>
        <p className="text-sm text-muted">{formatVolume(product)}</p>
        <p className="mt-auto pt-3 text-xl font-extrabold text-ink">{formatPrice(product.price)}</p>
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
