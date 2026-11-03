import { redirect } from "react-router";
import { renderShareCardPng, shareCardEtag } from "~/.server/og/label-card";
import { getOrRender } from "~/.server/og/label-card-cache";
import { resolveProductHandle } from "~/.server/services/products";
import { DEFAULT_LOCALE } from "~/lib/i18n";
import { productShareImagePath } from "~/lib/products";
import type { Route } from "./+types/og.products.$file";

// `/og/products/<handle>.png` (#105): the share image of a product without its own photo, the
// shop's bottle photo with the product's brand and name. Language-neutral, like the image. A
// resource route outside the shop layout, so no session, visitor cookie or analytics run for it.

export const SHARE_IMAGE_CACHE_CONTROL = "public, max-age=86400, stale-while-revalidate=604800";
/** A missing product may be added soon, so a 404 isn't cached for long. */
export const NOT_FOUND_CACHE_CONTROL = "public, max-age=300";

const SUFFIX = ".png";

function notFound(): Response {
  return new Response(null, { status: 404, headers: { "Cache-Control": NOT_FOUND_CACHE_CONTROL } });
}

/** Whether an `If-None-Match` header matches `etag` (weak comparison, as for GET). */
export function etagMatches(header: string | null, etag: string): boolean {
  if (!header) return false;
  const bare = (tag: string) => tag.trim().replace(/^W\//, "");
  return header.split(",").some((tag) => tag.trim() === "*" || bare(tag) === bare(etag));
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const file = params.file;
  // Route segments are whole, so `:handle.png` can't be a param: the suffix is checked here.
  if (!file.endsWith(SUFFIX) || file.length === SUFFIX.length) {
    return notFound();
  }
  const handle = file.slice(0, -SUFFIX.length);

  const found = await resolveProductHandle(handle, DEFAULT_LOCALE);
  if (!found) {
    return notFound();
  }
  if (found.kind === "redirect") {
    // An old UUID link or a renamed slug (#83): to the current image.
    return redirect(productShareImagePath({ id: found.publicId, slug: found.slug }), 301);
  }
  // Archived products (#88) aren't shared anymore.
  if (!found.available) {
    return notFound();
  }

  const { product, updatedAt } = found;
  const etag = shareCardEtag(product.id, updatedAt);
  const headers = { "Cache-Control": SHARE_IMAGE_CACHE_CONTROL, ETag: etag };
  if (etagMatches(request.headers.get("If-None-Match"), etag)) {
    return new Response(null, { status: 304, headers });
  }

  const png = await getOrRender(`${product.id}:${updatedAt.getTime()}`, () =>
    renderShareCardPng({
      id: product.id,
      brand: product.brand,
      title: product.title,
      family: product.fragranceFamilies[0] ?? null,
    }),
  );
  return new Response(new Uint8Array(png), {
    headers: { ...headers, "Content-Type": "image/png", "Content-Length": String(png.length) },
  });
}
