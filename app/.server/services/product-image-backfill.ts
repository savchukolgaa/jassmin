import { z } from "zod";
import { strapiMedia } from "../cms/schemas";
import { cmsWrite } from "../cms/writer";
import type { Db } from "../db/client";
import { type ProductImageWrite, updateProductImage } from "../db/queries/products";
import type { CmsSyncEnv } from "../env";

// `pnpm db:backfill-product-images` (#88): products synced before #88 only have their image's
// URL. This reads every product's image from Strapi and stores its size and resized formats, so
// product photos get an `srcset`. Edits made in Strapi afterwards keep them up to date.

const PAGE_SIZE = 100;

const productPage = z.object({
  data: z.array(z.object({ publicId: z.string().nullish(), image: strapiMedia.nullish() })),
  meta: z.object({ pagination: z.object({ page: z.number(), pageCount: z.number() }) }),
});

export type StrapiProductPage = z.infer<typeof productPage>;

/** The image columns for Strapi's media, its relative `/uploads/…` URLs resolved. */
export function toProductImageWrite(
  media: StrapiProductPage["data"][number]["image"],
  strapiUrl: string,
): ProductImageWrite {
  if (!media) {
    return { imageUrl: null, imageWidth: null, imageHeight: null, imageFormats: null };
  }
  const base = strapiUrl.endsWith("/") ? strapiUrl : `${strapiUrl}/`;
  const resolve = (url: string) => new URL(url, base).toString();
  return {
    imageUrl: resolve(media.url),
    imageWidth: media.width && media.width > 0 ? media.width : null,
    imageHeight: media.height && media.height > 0 ? media.height : null,
    imageFormats: Object.values(media.formats ?? {}).map(({ url, width, height }) => ({
      url: resolve(url),
      width,
      height,
    })),
  };
}

export interface ProductImageBackfillDeps {
  strapiUrl: string;
  fetchPage(page: number): Promise<StrapiProductPage>;
  update(publicId: string, image: ProductImageWrite): Promise<boolean>;
}

export function productImageBackfillDeps(db: Db, env: CmsSyncEnv): ProductImageBackfillDeps {
  return {
    strapiUrl: env.STRAPI_URL,
    fetchPage: (page) =>
      cmsWrite(
        env,
        {
          method: "GET",
          path: "products",
          query: {
            fields: ["publicId"],
            populate: ["image"],
            pagination: { page, pageSize: PAGE_SIZE },
          },
        },
        productPage,
      ),
    update: (publicId, image) => updateProductImage(db, publicId, image),
  };
}

export interface ProductImageBackfillReport {
  updated: number;
  /** Strapi products without a `publicId` or without a row in the app. */
  skipped: number;
}

/** Copies every Strapi product's image into the app, page by page. */
export async function backfillProductImages(
  deps: ProductImageBackfillDeps,
): Promise<ProductImageBackfillReport> {
  const report: ProductImageBackfillReport = { updated: 0, skipped: 0 };
  for (let page = 1, pageCount = 1; page <= pageCount; page += 1) {
    const result = await deps.fetchPage(page);
    pageCount = result.meta.pagination.pageCount;
    for (const product of result.data) {
      const updated =
        product.publicId &&
        (await deps.update(product.publicId, toProductImageWrite(product.image, deps.strapiUrl)));
      if (updated) {
        report.updated += 1;
      } else {
        report.skipped += 1;
      }
    }
  }
  return report;
}
