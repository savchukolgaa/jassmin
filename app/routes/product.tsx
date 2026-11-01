import { data, isRouteErrorResponse, Link, redirect } from "react-router";
import { trackEvent } from "~/.server/analytics";
import { resolveProductHandle } from "~/.server/services/products";
import { ErrorContent } from "~/components/layout/ErrorContent";
import { focusRing } from "~/components/layout/nav";
import { ProductImage } from "~/features/catalog/ProductImage";
import { ProductPurchase } from "~/features/product/ProductPurchase";
import { ProductFamilies, ProductNotes } from "~/features/product/ProductScent";
import { shouldRevalidateView } from "~/lib/analytics";
import { CATALOG_TITLE_KEYS, type CatalogGender } from "~/lib/catalog";
import type { Gender } from "~/lib/enums";
import { metaTranslator, useT } from "~/lib/i18n";
import { productHref } from "~/lib/products";
import { describeRouteError } from "~/lib/route-error";
import { errorMeta, priceAmount, seoMeta } from "~/lib/seo";
import type { Route } from "./+types/product";

/** The catalog to link back to. Unisex perfumes are in both, so they go back to the women's. */
function catalogOf(gender: Gender): CatalogGender {
  return gender === "men" ? "men" : "women";
}

// A shared product link shows its name, image and price (#85): messengers read only `og:title`,
// `og:description` and `og:image`, so the price leads the description too.
export function meta({ loaderData, matches, location, error }: Route.MetaArgs) {
  if (error || !loaderData) {
    return errorMeta({ matches, error });
  }
  const { t, formatPrice } = metaTranslator(matches);
  const { product } = loaderData;
  const name = `${product.title} — ${product.brand}`;
  const prices = product.variants.map((variant) => variant.price);
  const lowest = prices.reduce<string | undefined>(
    (min, price) => (min === undefined || Number(price) < Number(min) ? price : min),
    undefined,
  );
  const intro =
    lowest === undefined
      ? `${product.brand} ${product.title}.`
      : t("product.metaDescription", {
          brand: product.brand,
          title: product.title,
          price:
            new Set(prices.map(Number)).size > 1
              ? t("product.fromPrice", { price: formatPrice(lowest) })
              : formatPrice(lowest),
        });
  return seoMeta(
    { matches, location },
    {
      title: t("meta.title", { page: name }),
      description: `${intro} ${product.description ?? t("product.metaFallback")}`,
      type: "product",
      image: product.imageUrl ? { url: product.imageUrl, alt: name } : null,
      extra:
        lowest === undefined
          ? []
          : [
              { property: "product:price:amount", content: priceAmount(lowest) },
              { property: "product:price:currency", content: "UAH" },
              {
                property: "product:availability",
                content: product.variants.some((variant) => variant.inStock)
                  ? "in stock"
                  : "out of stock",
              },
            ],
    },
  );
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const found = await resolveProductHandle(params.handle);
  if (!found) {
    throw data(null, { status: 404 });
  }
  if (found.kind === "redirect") {
    // An old UUID link or a renamed slug (#83): permanently to the current URL, query kept.
    const { search } = new URL(request.url);
    throw redirect(`${productHref({ id: found.publicId, slug: found.slug })}${search}`, 301);
  }
  const { product } = found;
  void trackEvent({ request, context }, "product_view", {
    productId: found.id,
    properties: { publicId: product.id },
  });
  return { product };
}

// Adding to the cart doesn't change the product, and reloading would record a second view.
export const shouldRevalidate = shouldRevalidateView;

export default function Product({ loaderData }: Route.ComponentProps) {
  const { t } = useT();
  const { product } = loaderData;
  const catalog = catalogOf(product.gender);

  return (
    <main className="container mx-auto px-4 pt-8 pb-16">
      <nav aria-label={t("nav.breadcrumb")} className="text-sm">
        <Link
          to={`/catalog/${catalog}`}
          className={`rounded-pill font-bold text-primary-dark hover:underline ${focusRing("onLight")}`}
        >
          ← {t(CATALOG_TITLE_KEYS[catalog])}
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
          <p className="text-sm font-bold uppercase tracking-wide text-primary-dark">
            {product.brand}
          </p>
          <h1 className="text-4xl font-bold leading-tight tracking-[-0.01em] text-ink md:text-5xl">
            {product.title}
          </h1>
          <ProductFamilies families={product.fragranceFamilies} />
          <ProductPurchase product={product} />
          <ProductNotes notes={product.notes} />
          {product.description && (
            <section aria-labelledby="description-heading" className="mt-2">
              <h2
                id="description-heading"
                className="text-xl font-bold tracking-[-0.01em] text-ink"
              >
                {t("product.description")}
              </h2>
              <p className="mt-2 leading-relaxed text-body">{product.description}</p>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const { t } = useT();
  if (isRouteErrorResponse(error) && error.status === 404) {
    return (
      <ErrorContent message="404" details={t("product.notFound")}>
        <p className="mt-4 flex gap-4">
          <Link
            to="/catalog/women"
            className={`rounded-pill font-bold text-primary-dark underline ${focusRing("onLight")}`}
          >
            {t(CATALOG_TITLE_KEYS.women)}
          </Link>
          <Link
            to="/catalog/men"
            className={`rounded-pill font-bold text-primary-dark underline ${focusRing("onLight")}`}
          >
            {t(CATALOG_TITLE_KEYS.men)}
          </Link>
        </p>
      </ErrorContent>
    );
  }
  return <ErrorContent {...describeRouteError(error, t)} />;
}
