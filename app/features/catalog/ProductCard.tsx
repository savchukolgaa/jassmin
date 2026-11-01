import { useEffect, useState } from "react";
import { Link } from "react-router";
import { focusRing } from "~/components/layout/nav";
import { AddToCartForm } from "~/features/cart/AddToCartForm";
import { fragranceFamilyLabel } from "~/lib/catalog";
import { cn } from "~/lib/cn";
import { useT } from "~/lib/i18n";
import { cardPrice, formatVolume, type ProductSummary, productHref } from "~/lib/products";
import { CardVolumePicker } from "./CardVolumePicker";
import { FamilyChip } from "./FamilyChip";
import { ProductImage } from "./ProductImage";

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

/** The size picked on a card, and whether the page has hydrated so its price can follow it. */
function useCardSize(product: ProductSummary) {
  const [selectedId, setSelectedId] = useState(product.defaultVariant.id);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return { selectedId, setSelectedId, hydrated };
}

/**
 * The picked size's price. Before hydration the server can't know the pick, so when the sizes
 * cost different amounts it renders a skeleton for pages where JS runs (the `js` class from
 * `root.tsx`) and "from {lowest price}" for the rest.
 */
function CardPrice({
  product,
  selectedId,
  hydrated,
  className,
}: {
  product: ProductSummary;
  selectedId: string;
  hydrated: boolean;
  className?: string;
}) {
  const { t, formatPrice } = useT();
  const slot = cn("min-h-7 text-xl text-ink", className);

  if (!product.hasPriceRange) {
    return <p className={slot}>{formatPrice(product.minPrice)}</p>;
  }
  if (!hydrated) {
    return (
      <p className={slot}>
        <span
          aria-hidden="true"
          data-price-skeleton
          className="hidden h-7 w-24 rounded-pill bg-line align-middle in-[.js]:inline-block motion-safe:animate-pulse"
        />
        <span className="in-[.js]:hidden">
          {t("product.fromPrice", { price: formatPrice(product.minPrice) })}
        </span>
      </p>
    );
  }
  return (
    <p className={slot}>
      {/* Re-keyed so the price animates in again when the size changes. */}
      <span key={selectedId} className="inline-block animate-spin-in">
        {formatPrice(cardPrice(product, selectedId))}
      </span>
    </p>
  );
}

/** The size picker for several sizes; `null` for one, which the card shows as text. */
function SizePicker({
  product,
  onChange,
  className,
}: {
  product: ProductSummary;
  onChange: (variantId: string) => void;
  className?: string;
}) {
  if (product.variants.length < 2) {
    return null;
  }
  return (
    <CardVolumePicker
      variants={product.variants}
      packSize={product.packSize}
      defaultId={product.defaultVariant.id}
      onChange={onChange}
      className={className}
    />
  );
}

function CatalogProductCard({ product, headingLevel }: CardProps) {
  const Heading = `h${headingLevel}` as const;
  const translator = useT();
  const href = productHref(translator.locale, product);
  const { selectedId, setSelectedId, hydrated } = useCardSize(product);
  const single = product.variants.length < 2;

  return (
    <article className="lift flex w-full flex-col rounded-card bg-white p-3 ring-1 ring-line">
      <Link to={href} tabIndex={-1} aria-hidden="true">
        <ProductImage imageUrl={product.imageUrl} title={product.title} brand={product.brand} />
      </Link>
      <div className="flex flex-1 flex-col gap-1 px-2 pt-4">
        <p className="text-sm font-bold uppercase tracking-wide text-primary-dark">
          {product.brand}
        </p>
        <Heading className="text-xl font-bold leading-tight tracking-[-0.01em] text-ink">
          <Link to={href} className={`rounded hover:underline ${focusRing("onLight")}`}>
            {product.title}
          </Link>
        </Heading>
        {product.fragranceFamily && (
          <p className="pt-1">
            <FamilyChip family={product.fragranceFamily} size="sm" />
          </p>
        )}
        {single && (
          <p className="text-sm text-muted">
            {formatVolume(
              { volumeMl: product.defaultVariant.volumeMl, packSize: product.packSize },
              translator,
            )}
          </p>
        )}
        <CardPrice
          product={product}
          selectedId={selectedId}
          hydrated={hydrated}
          className="mt-auto pt-3 font-extrabold"
        />
      </div>
      <AddToCartForm
        productId={product.id}
        variantId={single ? product.defaultVariant.id : undefined}
        inStock={product.inStock}
        size="sm"
        className="flex flex-col gap-3 px-2 pt-3"
      >
        <SizePicker product={product} onChange={setSelectedId} />
      </AddToCartForm>
    </article>
  );
}

function CompactProductCard({ product, headingLevel }: CardProps) {
  const Heading = `h${headingLevel}` as const;
  const translator = useT();
  const { t } = translator;
  const href = productHref(translator.locale, product);
  const { selectedId, setSelectedId, hydrated } = useCardSize(product);
  const single = product.variants.length < 2;

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
          {product.brand}
          {single &&
            ` · ${formatVolume({ volumeMl: product.defaultVariant.volumeMl, packSize: product.packSize }, translator)}`}
        </p>
        <Heading className="text-lg leading-tight font-bold text-ink">
          <Link to={href} className={`rounded hover:underline ${focusRing("onLight")}`}>
            {product.title}
          </Link>
        </Heading>
      </div>
      {/* One grid so the price sits beside the round "+", which the form renders last. */}
      <AddToCartForm
        productId={product.id}
        variantId={single ? product.defaultVariant.id : undefined}
        inStock={product.inStock}
        label={t("product.quickAdd", { title: product.title })}
        appearance="icon"
        className="mt-auto grid grid-cols-[1fr_auto] items-center gap-3 px-2 pb-2"
      >
        <SizePicker product={product} onChange={setSelectedId} className="col-span-2" />
        <CardPrice
          product={product}
          selectedId={selectedId}
          hydrated={hydrated}
          className="font-serif font-bold"
        />
      </AddToCartForm>
    </article>
  );
}
