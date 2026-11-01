// The breadcrumb trails of the product, catalog and blog post pages (#86). The visible
// `Breadcrumbs` and the `BreadcrumbList` JSON-LD both use them, so they always match.
import { blogPostHref } from "./blog";
import { CATALOG_TITLE_KEYS, type CatalogGender } from "./catalog";
import type { Translator } from "./i18n";
import { productHref } from "./products";
import type { Breadcrumb } from "./structured-data";

type T = Translator["t"];

const home = (t: T): Breadcrumb => ({ name: t("nav.breadcrumbHome"), to: "/" });

const catalog = (t: T, gender: CatalogGender): Breadcrumb => ({
  name: t(CATALOG_TITLE_KEYS[gender]),
  to: `/catalog/${gender}`,
});

/** Home > Women's/Men's perfume. The path has no query string, so filters and pages don't leak. */
export function catalogBreadcrumbs(t: T, gender: CatalogGender): Breadcrumb[] {
  return [home(t), catalog(t, gender)];
}

/** Home > the product's catalog > the product. */
export function productBreadcrumbs(
  t: T,
  gender: CatalogGender,
  product: { id: string; slug: string | null; title: string },
): Breadcrumb[] {
  return [...catalogBreadcrumbs(t, gender), { name: product.title, to: productHref(product) }];
}

/** Home > Blog > the post. */
export function blogPostBreadcrumbs(t: T, post: { slug: string; title: string }): Breadcrumb[] {
  return [
    home(t),
    { name: t("nav.blog"), to: "/blog" },
    { name: post.title, to: blogPostHref(post.slug) },
  ];
}
