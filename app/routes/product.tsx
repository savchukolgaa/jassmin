import { data, isRouteErrorResponse, Link } from "react-router";
import { z } from "zod";
import { trackEvent } from "~/.server/analytics";
import { getProductWithId } from "~/.server/services/products";
import { ErrorContent } from "~/components/layout/ErrorContent";
import { focusRing } from "~/components/layout/nav";
import { ProductImage } from "~/features/catalog/ProductImage";
import { ProductPurchase } from "~/features/product/ProductPurchase";
import { ProductFamilies, ProductNotes } from "~/features/product/ProductScent";
import { shouldRevalidateView } from "~/lib/analytics";
import { CATALOG_TITLE_KEYS, type CatalogGender } from "~/lib/catalog";
import type { Gender } from "~/lib/enums";
import { useT } from "~/lib/i18n";
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

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const id = z.uuid().safeParse(params.id);
  const found = id.success ? await getProductWithId(id.data) : null;
  if (!found) {
    throw data(null, { status: 404 });
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
