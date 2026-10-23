import type { CmsImage } from "~/lib/cms";
import { cn } from "~/lib/cn";

export interface BlogCoverProps {
  image: CmsImage | null;
  /** `sizes` for the `srcSet`: how wide the cover is shown at each breakpoint. */
  sizes: string;
  className?: string;
  /** Load eagerly, e.g. for the article's cover above the fold. */
  eager?: boolean;
}

/**
 * Blog cover with a fixed 3:2 frame, or a blush placeholder when the post has none. The alt text
 * comes from Strapi; empty means decorative, since the post title is always right next to it.
 */
export function BlogCover({ image, sizes, className, eager = false }: BlogCoverProps) {
  const frame = cn("aspect-[3/2] w-full overflow-hidden rounded-card bg-blush", className);

  if (!image) {
    return <div className={frame} aria-hidden="true" />;
  }

  return (
    <div className={frame}>
      <img
        src={image.url}
        srcSet={image.srcSet ?? undefined}
        sizes={image.srcSet ? sizes : undefined}
        width={image.width ?? undefined}
        height={image.height ?? undefined}
        alt={image.alt}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        className="size-full object-cover"
      />
    </div>
  );
}
