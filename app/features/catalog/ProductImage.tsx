import { cn } from "~/lib/cn";
import { PRODUCT_IMAGE_SIZES, type ProductImageLayout, type ResponsiveImage } from "~/lib/images";

export interface ProductImageProps {
  image: ResponsiveImage | null;
  /** The placeholder's initial without a photo. */
  brand: string;
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

/** Product photo with a fixed 4:5 frame, or a placeholder with the brand initial. */
export function ProductImage({
  image,
  brand,
  alt,
  layout,
  className,
  priority = false,
}: ProductImageProps) {
  const frame = cn("aspect-[4/5] w-full overflow-hidden rounded-card bg-blush", className);

  if (!image) {
    const initial = (
      <span aria-hidden="true" className="text-5xl font-extrabold text-primary-dark">
        {brand.charAt(0)}
      </span>
    );
    return alt ? (
      <div className={cn(frame, "flex items-center justify-center")} role="img" aria-label={alt}>
        {initial}
      </div>
    ) : (
      <div className={cn(frame, "flex items-center justify-center")} aria-hidden="true">
        {initial}
      </div>
    );
  }

  return (
    <div className={frame}>
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
    </div>
  );
}
