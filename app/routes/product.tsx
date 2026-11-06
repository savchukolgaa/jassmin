import { data, isRouteErrorResponse, redirect } from "react-router";
import { trackEvent } from "~/.server/analytics";
import { getLocale } from "~/.server/locale";
import { getSimilarProducts, resolveProductHandle } from "~/.server/services/products";
import { JsonLd } from "~/components/JsonLd";
import { Breadcrumbs } from "~/components/layout/Breadcrumbs";
import { ErrorContent } from "~/components/layout/ErrorContent";
import { useProductDwell } from "~/features/analytics/useProductDwell";
import { ProductImage } from "~/features/catalog/ProductImage";
import { ProductUnavailable, SimilarProducts } from "~/features/product/ProductArchived";
import { ProductPurchase } from "~/features/product/ProductPurchase";
import { ProductFamilies, ProductNotes } from "~/features/product/ProductScent";
import { productEventContext, shouldRevalidateView } from "~/lib/analytics";
import { productBreadcrumbs } from "~/lib/breadcrumbs";
import type { CatalogGender } from "~/lib/catalog";
import type { Gender } from "~/lib/enums";
import { metaTranslator, useContentLang, useT } from "~/lib/i18n";
import {
  descriptionParagraphs,
  formatVolume,
  productHref,
  productShareImagePath,
  SHARE_IMAGE_SIZE,
} from "~/lib/products";
import { describeRouteError } from "~/lib/route-error";
import { errorMeta, priceAmount, seoMeta } from "~/lib/seo";
import { breadcrumbListLd, productLd } from "~/lib/structured-data";
import { useSiteUrl } from "~/lib/use-site-url";
import type { Route } from "./+types/product";

/** The catalog to link back to. Unisex perfumes are in both, so they go back to the women's. */
function catalogOf(gender: Gender): CatalogGender {
  return gender === "men" ? "men" : "women";
}

// A shared product link shows its name, image and price (#85): messengers read only `og:title`,
// `og:description` and `og:image`, so the price leads the description too. Without its own photo,
// the image is generated from the product's brand and name (#105).
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
      image: product.image
        ? {
            url: product.image.url,
            alt: name,
            width: product.image.width,
            height: product.image.height,
          }
        : // The shop's bottle photo with this product's brand and name (#105).
          { url: productShareImagePath(product), alt: name, ...SHARE_IMAGE_SIZE },
      // An archived product's page stays for old links, out of search results (#88).
      noindex: !loaderData.available,
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
  const locale = await getLocale(request);
  // The description comes in the page's language, or in Ukrainian while it has no English (#100).
  const found = await resolveProductHandle(params.handle, locale);
  if (!found) {
    throw data(null, { status: 404 });
  }
  if (found.kind === "redirect") {
    // An old UUID link or a renamed slug (#83): permanently to the current URL, query kept.
    const { search } = new URL(request.url);
    const target = productHref(locale, { id: found.publicId, slug: found.slug });
    throw redirect(`${target}${search}`, 301);
  }
  const { product, available } = found;
  void trackEvent({ request, context }, "product_view", {
    productId: found.id,
    // The preselected size, as the page first shows it (#129).
    properties: productEventContext(product),
  });
  // An archived product (#88) suggests listed perfumes like it instead.
  const similar = available ? [] : await getSimilarProducts(found.id, product);
  return { product, available, similar };
}

// Adding to the cart doesn't change the product, and reloading would record a second view.
export const shouldRevalidate = shouldRevalidateView;

export default function Product({ loaderData }: Route.ComponentProps) {
  const translator = useT();
  const { t } = translator;
  const siteUrl = useSiteUrl();
  const { product, available, similar } = loaderData;
  // How long the page is read and how far down, sent when the visitor leaves (#129).
  useProductDwell(product);
  const catalog = catalogOf(product.gender);
  const breadcrumbs = productBreadcrumbs(translator, catalog, product);
  const descriptionLang = useContentLang(product.descriptionLocale);
  const productData = productLd({
    origin: siteUrl,
    product,
    path: productHref(translator.locale, product),
    variantName: ({ volumeMl }) =>
      formatVolume({ volumeMl, packSize: product.packSize }, translator),
  });

  return (
    <main className="container mx-auto px-4 pt-8 pb-16">
      {/* No Product offers for an archived product, which isn't sold anymore (#88). */}
      {available && productData && <JsonLd data={productData} />}
      <JsonLd data={breadcrumbListLd(siteUrl, breadcrumbs)} />
      <Breadcrumbs items={breadcrumbs} />

      <div className="mt-6 grid gap-8 md:grid-cols-2 md:gap-12">
        <ProductImage
          image={product.image}
          alt={t("product.imageAlt", { brand: product.brand, title: product.title })}
          layout="page"
          priority
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
          {available ? (
            <ProductPurchase product={product} />
          ) : (
            <ProductUnavailable catalog={catalog} />
          )}
          <ProductNotes notes={product.notes} />
          {product.description && (
            <section aria-labelledby="description-heading" className="mt-2" lang={descriptionLang}>
              <h2
                id="description-heading"
                className="text-xl font-bold tracking-[-0.01em] text-ink"
              >
                {t("product.description")}
              </h2>
              {descriptionParagraphs(product.description).map((paragraph, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static text, never reordered
                <p key={index} className="mt-2 leading-relaxed text-body">
                  {paragraph}
                </p>
              ))}
            </section>
          )}
        </div>
      </div>
      <SimilarProducts products={similar} />
    </main>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const { t } = useT();
  if (isRouteErrorResponse(error) && error.status === 404) {
    return <ErrorContent message="404" details={t("product.notFound")} notFound />;
  }
  return <ErrorContent {...describeRouteError(error, t)} />;
}
