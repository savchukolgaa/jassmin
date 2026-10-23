import { cn } from "~/lib/cn";

export interface ProductImageProps {
  imageUrl: string | null;
  title: string;
  brand: string;
  className?: string;
  /** Load eagerly, e.g. for the product page's main image. */
  eager?: boolean;
}

/** Product photo with a fixed aspect ratio, or a placeholder with the brand initial. */
export function ProductImage({
  imageUrl,
  title,
  brand,
  className,
  eager = false,
}: ProductImageProps) {
  const frame = cn("aspect-[4/5] w-full overflow-hidden rounded-card bg-blush", className);

  if (!imageUrl) {
    return (
      <div className={cn(frame, "flex items-center justify-center")} role="img" aria-label={title}>
        <span aria-hidden="true" className="text-5xl font-extrabold text-primary-dark">
          {brand.charAt(0)}
        </span>
      </div>
    );
  }

  return (
    <div className={frame}>
      <img
        src={imageUrl}
        alt={title}
        loading={eager ? "eager" : "lazy"}
        className="size-full object-cover"
      />
    </div>
  );
}
