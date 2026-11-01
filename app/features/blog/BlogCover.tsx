import type { CmsImage } from "~/lib/cms";
import { cn } from "~/lib/cn";

export interface BlogCoverProps {
  image: CmsImage | null;
  /** `sizes` for the `srcSet`: how wide the cover is shown at each breakpoint. */
  sizes: string;
  className?: string;
  /**
   * Alt text in place of Strapi's: `""` where the cover repeats a link with the title next to it
   * (cards), or a translated fallback when the editor left it blank (#88).
   */
  alt?: string;
  /** The page's main image (the article's cover, LCP): loaded first instead of lazily. */
  eager?: boolean;
}

/** Blog cover with a fixed 3:2 frame, or a blush placeholder when the post has none. */
export function BlogCover({ image, sizes, alt, className, eager = false }: BlogCoverProps) {
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
        alt={alt ?? image.alt}
        loading={eager ? "eager" : "lazy"}
        fetchPriority={eager ? "high" : undefined}
        decoding="async"
        className="size-full object-cover"
      />
    </div>
  );
}
