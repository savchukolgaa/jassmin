import { cn } from "~/lib/cn";
import { PRODUCT_IMAGE_SIZES, type ProductImageLayout, type ResponsiveImage } from "~/lib/images";
import { labelPalette, type ProductLabel } from "~/lib/label-art";
import { SHOP_BOTTLE_IMAGE } from "~/lib/shop-bottle";
import { ProductLabelArt } from "./ProductLabelArt";

export interface ProductImageProps {
  image: ResponsiveImage | null;
  /**
   * Who the product is without a photo: its family colours the strip under the shop photo (#118),
   * and thumbnails draw it as a label card (#99).
   */
  label: ProductLabel;
  /** `minimal` leaves the text off the label card, for thumbnails. */
  labelDetail?: "full" | "minimal";
  /**
   * "<brand> <name>" (`product.imageAlt`) where the photo is the content, `""` where it repeats a
   * link with the product's name next to it, e.g. on cards.
   */
  alt: string;
  /** How wide the image is shown, for the `sizes` attribute (#88). */
  layout: ProductImageLayout;
  className?: string;
  /** The page's largest image (LCP): loaded first instead of lazily (#88). */
  priority?: boolean;
}

/**
 * Product photo with a fixed 4:5 frame. Without one it shows the shop's bottle photo (every
 * perfume comes in the same bottle) with a strip in the product's fragrance-family colour (#118),
 * or, in thumbnails, the generated label card (#99).
 */
export function ProductImage({
  image,
  label,
  labelDetail = "full",
  alt,
  layout,
  className,
  priority = false,
}: ProductImageProps) {
  const frame = cn("aspect-[4/5] w-full overflow-hidden rounded-card", className);

  if (image) {
    return (
      <div className={cn(frame, "bg-blush")}>
        <Photo image={image} alt={alt} layout={layout} priority={priority} />
      </div>
    );
  }

  if (layout !== "thumb") {
    return (
      <div className={cn(frame, "relative bg-blush")}>
        <Photo image={SHOP_BOTTLE_IMAGE} alt={alt} layout={layout} priority={priority} />
        <span
          aria-hidden="true"
          data-family-strip=""
          className="absolute inset-x-0 bottom-0 h-2"
          style={{ backgroundColor: labelPalette(label.family).accent }}
        />
      </div>
    );
  }

  const art = <ProductLabelArt label={label} detail={labelDetail} className="block size-full" />;
  return alt ? (
    <div className={frame} role="img" aria-label={alt}>
      {art}
    </div>
  ) : (
    <div className={frame} aria-hidden="true">
      {art}
    </div>
  );
}

function Photo({
  image,
  alt,
  layout,
  priority,
}: {
  image: ResponsiveImage;
  alt: string;
  layout: ProductImageLayout;
  priority: boolean;
}) {
  return (
    <img
      src={image.url}
      srcSet={image.srcSet ?? undefined}
      sizes={image.srcSet ? PRODUCT_IMAGE_SIZES[layout] : undefined}
      width={image.width ?? undefined}
      height={image.height ?? undefined}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      decoding="async"
      className="size-full object-cover"
    />
  );
}
