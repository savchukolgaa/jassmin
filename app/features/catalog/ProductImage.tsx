import { cn } from "~/lib/cn";
import { PRODUCT_IMAGE_SIZES, type ProductImageLayout, type ResponsiveImage } from "~/lib/images";
import type { ProductLabel } from "~/lib/label-art";
import { SHOP_BOTTLE_IMAGE } from "~/lib/shop-bottle";
import { ProductLabelArt } from "./ProductLabelArt";

export interface ProductImageProps {
  image: ResponsiveImage | null;
  /** What the thumbnail label card shows without a photo (#99). */
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
 * perfume comes in the same bottle, #118), or, in thumbnails, the generated label card (#99).
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
  const photo = image ?? (layout === "thumb" ? null : SHOP_BOTTLE_IMAGE);

  if (photo) {
    return (
      <div className={cn(frame, "bg-blush")}>
        <img
          src={photo.url}
          srcSet={photo.srcSet ?? undefined}
          sizes={photo.srcSet ? PRODUCT_IMAGE_SIZES[layout] : undefined}
          width={photo.width ?? undefined}
          height={photo.height ?? undefined}
          alt={alt}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : undefined}
          decoding="async"
          className="size-full object-cover"
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
