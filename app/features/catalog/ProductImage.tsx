import { cn } from "~/lib/cn";
import { PRODUCT_IMAGE_SIZES, type ProductImageLayout, type ResponsiveImage } from "~/lib/images";
import { SHOP_BOTTLE_IMAGE } from "~/lib/shop-bottle";

export interface ProductImageProps {
  /** The product's own photo; `null` shows the shop's bottle photo. */
  image: ResponsiveImage | null;
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
 * Product photo with a fixed 4:5 frame, or the shop's bottle photo without one: every perfume
 * comes in the same bottle (#118, #122).
 */
export function ProductImage({
  image,
  alt,
  layout,
  className,
  priority = false,
}: ProductImageProps) {
  const photo = image ?? SHOP_BOTTLE_IMAGE;

  return (
    <div className={cn("aspect-[4/5] w-full overflow-hidden rounded-card bg-blush", className)}>
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
