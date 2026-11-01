import { CATALOG_GENDERS } from "~/lib/catalog";
import { PRIVACY_POLICY_UPDATED_AT } from "~/lib/consent";
import { LOCALES, type Locale } from "~/lib/i18n";
import { type Page, type PathArgs, pathFor } from "~/lib/paths";
import { listBlogPostsForSitemap, type SitemapBlogPost } from "../cms/content";
import { isCmsError } from "../cms/errors";
import { db as defaultDb } from "../db";
import type { Db } from "../db/client";
import { listSitemapProducts, type SitemapProductRow } from "../db/queries/products";
import { buildSitemapXml, type SitemapPage } from "../seo/sitemap";
import { GENDER_SCOPE } from "./products";

// Gathers every indexable URL for `/sitemap.xml` (#87): the fixed pages, every product on sale
// (from the database) and every published blog post (from Strapi), each in every locale it exists
// in.

export interface SitemapSources {
  products: readonly SitemapProductRow[];
  /** `null` when Strapi couldn't be reached: the sitemap then lists everything but the posts. */
  posts: readonly SitemapBlogPost[] | null;
}

/**
 * The indexable pages without parameters, plus each catalog. Products and posts come from the
 * data; a test checks that this covers every `indexable` page in the path table.
 */
export const SITEMAP_PAGES = [
  "home",
  "catalog",
  "offers",
  "popular",
  "blog",
  "privacy",
  "product",
  "blogPost",
] as const satisfies readonly Page[];

/** The page's URL in every locale. */
function everyLocale<P extends Page>(
  page: P,
  ...args: PathArgs<P>
): Partial<Record<Locale, string>> {
  return Object.fromEntries(LOCALES.map((locale) => [locale, pathFor(locale, page, ...args)]));
}

/** The latest of `dates` as an ISO string, or `undefined` when there are none. */
function latest(dates: Iterable<Date | string>): string | undefined {
  let max: number | undefined;
  for (const date of dates) {
    const time = new Date(date).getTime();
    if (max === undefined || time > max) max = time;
  }
  return max === undefined ? undefined : new Date(max).toISOString();
}

/**
 * The sitemap's pages. `lastmod` is the product's or post's last edit. A list page takes its
 * newest product's or post's: the catalogs their genders’, home, offers and popular any product’s.
 */
export function sitemapPages({ products, posts }: SitemapSources): SitemapPage[] {
  const productsChanged = latest(products.map((product) => product.updatedAt));
  const pages: SitemapPage[] = [
    { paths: everyLocale("home"), lastmod: productsChanged },
    ...CATALOG_GENDERS.map((gender) => ({
      paths: everyLocale("catalog", { gender }),
      lastmod: latest(
        products
          .filter((product) => GENDER_SCOPE[gender].includes(product.gender))
          .map((product) => product.updatedAt),
      ),
    })),
    { paths: everyLocale("offers"), lastmod: productsChanged },
    { paths: everyLocale("popular"), lastmod: productsChanged },
    { paths: everyLocale("blog"), lastmod: latest((posts ?? []).map((post) => post.updatedAt)) },
    { paths: everyLocale("privacy"), lastmod: PRIVACY_POLICY_UPDATED_AT },
  ];

  for (const product of products) {
    if (product.slug === null) continue;
    pages.push({
      paths: everyLocale("product", { handle: product.slug }),
      lastmod: product.updatedAt.toISOString(),
    });
  }

  for (const post of posts ?? []) {
    const paths: Partial<Record<Locale, string>> = {};
    for (const locale of LOCALES) {
      const slug = post.slugs[locale];
      if (slug !== undefined) paths[locale] = pathFor(locale, "blogPost", { slug });
    }
    pages.push({ paths, lastmod: post.updatedAt });
  }

  return pages;
}

export interface SitemapDeps {
  listProducts: () => Promise<readonly SitemapProductRow[]>;
  listPosts: () => Promise<readonly SitemapBlogPost[]>;
}

function defaultDeps(db: Db): SitemapDeps {
  return { listProducts: () => listSitemapProducts(db), listPosts: listBlogPostsForSitemap };
}

/**
 * The sitemap XML on `siteUrl`. When Strapi is down it still lists the database-backed pages,
 * without the posts, and says so with `complete: false` (the route caches it for less time). A
 * database error is thrown: without products there's nothing worth serving.
 */
export async function getSitemap(
  siteUrl: string,
  deps: SitemapDeps = defaultDeps(defaultDb),
): Promise<{ xml: string; complete: boolean }> {
  const [products, posts] = await Promise.all([
    deps.listProducts(),
    deps.listPosts().catch((error: unknown) => {
      if (!isCmsError(error)) throw error;
      console.warn(`Sitemap without blog posts, Strapi is unavailable: ${error.message}`);
      return null;
    }),
  ]);
  return {
    xml: buildSitemapXml(sitemapPages({ products, posts }), siteUrl),
    complete: posts !== null,
  };
}
