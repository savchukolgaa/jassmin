import { Link } from "react-router";
import { focusRing } from "~/components/layout/nav";
import { ButtonLink } from "~/components/ui/ButtonLink";
import { AddToCartForm } from "~/features/cart/AddToCartForm";
import { fragranceFamilyLabel } from "~/lib/catalog";
import { useT } from "~/lib/i18n";
import { formatVolume, formatVolumes, type ProductSummary } from "~/lib/products";
import { FamilyChip } from "./FamilyChip";
import { ProductImage } from "./ProductImage";

export function productHref(id: string): string {
  return `/products/${id}`;
}

type ProductCardProps = {
  product: ProductSummary;
  /** The title's heading level: `h2` in the catalog, deeper where the card sits under others. */
  headingLevel?: 2 | 3 | 4;
  /**
   * `compact`: the home page's bestseller card (HomeBoldPlus, #64), with the family on the image
   * and a round quick-add button.
   */
  variant?: "default" | "compact";
};

export function ProductCard({ product, headingLevel = 2, variant = "default" }: ProductCardProps) {
  return variant === "compact" ? (
    <CompactProductCard product={product} headingLevel={headingLevel} />
  ) : (
    <CatalogProductCard product={product} headingLevel={headingLevel} />
  );
}

type CardProps = Required<Pick<ProductCardProps, "product" | "headingLevel">>;

function CatalogProductCard({ product, headingLevel }: CardProps) {
  const Heading = `h${headingLevel}` as const;
  const translator = useT();
  const { t } = translator;
  const href = productHref(product.id);
  const price = translator.formatPrice(product.minPrice);
  // The card can't show a size picker, so its button says which size it adds.
  const defaultSize = formatVolume(
    { volumeMl: product.defaultVariant.volumeMl, packSize: product.packSize },
    translator,
  );

  return (
    <article className="lift flex w-full flex-col rounded-card bg-white p-3 ring-1 ring-line">
      <Link to={href} tabIndex={-1} aria-hidden="true">
        <ProductImage imageUrl={product.imageUrl} title={product.title} brand={product.brand} />
      </Link>
      <div className="flex flex-1 flex-col gap-1 px-2 pt-4">
        <p className="text-sm font-bold uppercase tracking-wide text-primary-dark">
          {product.brand}
        </p>
        <Heading className="text-xl font-extrabold leading-tight tracking-[-0.03em] text-ink">
          <Link to={href} className={`rounded hover:underline ${focusRing("onLight")}`}>
            {product.title}
          </Link>
        </Heading>
        {product.fragranceFamily && (
          <p className="pt-1">
            <FamilyChip family={product.fragranceFamily} size="sm" />
          </p>
        )}
        <p className="text-sm text-muted">{formatVolumes(product, translator)}</p>
        <p className="mt-auto pt-3 text-xl font-extrabold text-ink">
          {product.hasPriceRange ? t("product.fromPrice", { price }) : price}
        </p>
      </div>
      <div className="flex flex-wrap items-start gap-2 px-2 pt-3">
        <AddToCartForm
          productId={product.id}
          variantId={product.defaultVariant.id}
          inStock={product.inStock}
          label={t("product.addSize", { size: defaultSize })}
          size="sm"
          className="min-w-32 flex-1"
        />
        {product.volumes.length > 1 && (
          <ButtonLink to={href} variant="ghost" size="sm" className="min-w-32 flex-1">
            {t("product.chooseVolume")}
          </ButtonLink>
        )}
      </div>
    </article>
  );
}

function CompactProductCard({ product, headingLevel }: CardProps) {
  const Heading = `h${headingLevel}` as const;
  const translator = useT();
  const { t } = translator;
  const href = productHref(product.id);
  const price = translator.formatPrice(product.minPrice);
  const defaultSize = formatVolume(
    { volumeMl: product.defaultVariant.volumeMl, packSize: product.packSize },
    translator,
  );

  return (
    <article className="card-tilt flex w-full flex-col gap-3 rounded-card bg-card p-3">
      <Link
        to={href}
        tabIndex={-1}
        aria-hidden="true"
        className="relative block overflow-hidden rounded-2xl"
      >
        <div data-zoom>
          <ProductImage
            imageUrl={product.imageUrl}
            title={product.title}
            brand={product.brand}
            className="rounded-2xl"
          />
        </div>
        {product.fragranceFamily && (
          <span className="absolute top-3 left-3 rounded-pill bg-white px-2.5 py-1.5 text-xs font-extrabold text-ink">
            {fragranceFamilyLabel(product.fragranceFamily, translator)}
          </span>
        )}
      </Link>
      <div className="flex flex-col gap-1 px-2">
        <p className="text-sm font-bold text-muted">
          {product.brand} · {defaultSize}
        </p>
        <Heading className="text-lg leading-tight font-extrabold text-ink">
          <Link to={href} className={`rounded hover:underline ${focusRing("onLight")}`}>
            {product.title}
          </Link>
        </Heading>
      </div>
      <div className="mt-auto flex items-center justify-between gap-3 px-2 pb-2">
        <p className="text-xl font-extrabold text-ink">
          {product.hasPriceRange ? t("product.fromPrice", { price }) : price}
        </p>
        <AddToCartForm
          productId={product.id}
          variantId={product.defaultVariant.id}
          inStock={product.inStock}
          label={t("product.quickAdd", { title: product.title, size: defaultSize })}
          appearance="icon"
        />
      </div>
    </article>
  );
}
