// The breadcrumb trails of the product, catalog and blog post pages (#86). The visible
// `Breadcrumbs` and the `BreadcrumbList` JSON-LD both use them, so they always match.
import { blogPostHref } from "./blog";
import { CATALOG_TITLE_KEYS, type CatalogGender } from "./catalog";
import type { Translator } from "./i18n";
import { pathFor } from "./paths";
import { productHref } from "./products";
import type { Breadcrumb } from "./structured-data";

/** The translator of the page's language: names and paths are both in it (#84). */
type T = Pick<Translator, "t" | "locale">;

const home = ({ t, locale }: T): Breadcrumb => ({
  name: t("nav.breadcrumbHome"),
  to: pathFor(locale, "home"),
});

const catalog = ({ t, locale }: T, gender: CatalogGender): Breadcrumb => ({
  name: t(CATALOG_TITLE_KEYS[gender]),
  to: pathFor(locale, "catalog", { gender }),
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
  return [
    ...catalogBreadcrumbs(t, gender),
    { name: product.title, to: productHref(t.locale, product) },
  ];
}

/** Home > Blog > the post. */
export function blogPostBreadcrumbs(t: T, post: { slug: string; title: string }): Breadcrumb[] {
  return [
    home(t),
    { name: t.t("nav.blog"), to: pathFor(t.locale, "blog") },
    { name: post.title, to: blogPostHref(t.locale, post.slug) },
  ];
}
