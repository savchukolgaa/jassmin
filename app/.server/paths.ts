import type { Locale } from "~/lib/i18n";
import { matchPage, pathFor, translatePath } from "~/lib/paths";
import { getBlogPostBySlug } from "./cms/content";

/**
 * The URL of the same page in `locale`, keeping the query and hash (#84): for the language
 * switcher and the redirect of visitors who chose English. A blog post goes to its slug in
 * `locale`, or to the blog list when it isn't translated (or the CMS is down). A path that isn't
 * a page goes to `locale`'s home page.
 */
export async function localizedUrl(path: string, locale: Locale): Promise<string> {
  const url = new URL(path, "http://localhost");
  const match = matchPage(url.pathname);
  if (!match) {
    return pathFor(locale, "home");
  }
  if (match.page !== "blogPost" || match.locale === locale) {
    return translatePath(path, locale) ?? pathFor(locale, "home");
  }
  const slug = match.params.slug ?? "";
  const post = await getBlogPostBySlug(slug, match.locale).catch(() => null);
  const translated = post?.alternates[locale];
  return translated
    ? pathFor(locale, "blogPost", { slug: translated }, { search: url.search, hash: url.hash })
    : pathFor(locale, "blog");
}
