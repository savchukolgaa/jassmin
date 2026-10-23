import { data, isRouteErrorResponse, Link } from "react-router";
import { z } from "zod";
import { getProduct } from "~/.server/services/products";
import { ErrorContent } from "~/components/layout/ErrorContent";
import { AddToCartForm } from "~/features/cart/AddToCartForm";
import { ProductImage } from "~/features/catalog/ProductImage";
import { StockStatus } from "~/features/catalog/StockStatus";
import { CATALOG_TITLES, type CatalogGender } from "~/lib/catalog";
import type { Gender } from "~/lib/enums";
import { formatPrice } from "~/lib/money";
import { formatVolume } from "~/lib/products";
import { describeRouteError } from "~/lib/route-error";
import type { Route } from "./+types/product";

const DESCRIPTION_LENGTH = 160;

/** The catalog to link back to. Unisex perfumes are in both, so they go back to the women's. */
function catalogOf(gender: Gender): CatalogGender {
  return gender === "men" ? "men" : "women";
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) {
    return [{ title: "Jassmin" }];
  }
  const { product } = loaderData;
  return [
    { title: `${product.title} — ${product.brand} — Jassmin` },
    {
      name: "description",
      content: (product.description ?? product.title).slice(0, DESCRIPTION_LENGTH),
    },
  ];
}

export async function loader({ params }: Route.LoaderArgs) {
  const id = z.uuid().safeParse(params.id);
  const product = id.success ? await getProduct(id.data) : null;
  if (!product) {
    throw data(null, { status: 404 });
  }
  // #18: trackEvent(request, "product_view", { productId: product.id }).
  return { product };
}

export default function Product({ loaderData }: Route.ComponentProps) {
  const { product } = loaderData;
  const catalog = catalogOf(product.gender);

  return (
    <main className="container mx-auto px-4 pt-8 pb-16">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link
          to={`/catalog/${catalog}`}
          className="font-semibold text-primary-dark hover:underline"
        >
          ← {CATALOG_TITLES[catalog]}
        </Link>
      </nav>

      <div className="mt-6 grid gap-8 md:grid-cols-2 md:gap-12">
        <ProductImage
          imageUrl={product.imageUrl}
          title={product.title}
          brand={product.brand}
          eager
          className="md:rounded-t-full"
        />

        <div className="flex flex-col gap-4">
          <p className="text-sm font-semibold uppercase tracking-wide text-primary-dark">
            {product.brand}
          </p>
          <h1 className="text-4xl font-extrabold leading-tight tracking-tight">{product.title}</h1>
          <div className="flex flex-wrap items-center gap-2">
            {product.fragranceFamily && (
              <span className="rounded-full bg-primary-light/15 px-3 py-1 text-sm font-semibold">
                {product.fragranceFamily}
              </span>
            )}
            <span className="text-gray-600 dark:text-gray-400">{formatVolume(product)}</span>
          </div>
          <p className="text-3xl font-extrabold">{formatPrice(product.price)}</p>
          <StockStatus
            inStock={product.inStock}
            stockQuantity={product.stockQuantity}
            className="self-start"
          />
          <AddToCartForm
            productId={product.id}
            inStock={product.stockQuantity > 0}
            size="lg"
            className="max-w-sm"
          />
          {product.description && (
            <section aria-labelledby="description-heading" className="mt-2">
              <h2 id="description-heading" className="text-lg font-bold">
                Description
              </h2>
              <p className="mt-2 leading-relaxed text-gray-700 dark:text-gray-300">
                {product.description}
              </p>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  if (isRouteErrorResponse(error) && error.status === 404) {
    return (
      <ErrorContent message="404" details="This perfume could not be found.">
        <p className="mt-4 flex gap-4">
          <Link to="/catalog/women" className="font-semibold text-primary-dark underline">
            {CATALOG_TITLES.women}
          </Link>
          <Link to="/catalog/men" className="font-semibold text-primary-dark underline">
            {CATALOG_TITLES.men}
          </Link>
        </p>
      </ErrorContent>
    );
  }
  return <ErrorContent {...describeRouteError(error)} />;
}
