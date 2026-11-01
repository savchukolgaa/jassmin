import { data, useNavigation } from "react-router";
import { listBlogPosts } from "~/.server/cms/content";
import { cmsUnavailable } from "~/.server/cms/errors";
import { getLocale } from "~/.server/locale";
import { blogCacheHeaders, buildBlogListView } from "~/.server/services/blog";
import { ErrorContent } from "~/components/layout/ErrorContent";
import { ButtonLink } from "~/components/ui/ButtonLink";
import { Pagination } from "~/components/ui/Pagination";
import { BlogPostCard } from "~/features/blog/BlogPostCard";
import { BLOG_PAGE_SIZE, blogHref, blogResponseHeaders, parseBlogSearch } from "~/lib/blog";
import { cn } from "~/lib/cn";
import { metaTranslator, usePathFor, useT } from "~/lib/i18n";
import { describeRouteError } from "~/lib/route-error";
import { errorMeta, seoMeta } from "~/lib/seo";
import type { Route } from "./+types/blog";

// Paginated: each page is self-canonical (#85).
export function meta({ loaderData, matches, location, error }: Route.MetaArgs) {
  if (error) {
    return errorMeta({ matches, error });
  }
  const { t } = metaTranslator(matches);
  const page = loaderData?.page ?? 1;
  return seoMeta(
    { matches, location },
    {
      title: t("meta.title", {
        page: page > 1 ? t("blog.pageTitle", { page }) : t("blog.title"),
      }),
      description: t("blog.defaultDescription"),
      keepParams: ["page"],
    },
  );
}

export function headers({ loaderHeaders }: Route.HeadersArgs) {
  return blogResponseHeaders(loaderHeaders);
}

// Published Strapi posts, newest first, in the visitor's language where translated. A page past the end is a 404; an outage becomes a 503.
export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const { page } = parseBlogSearch(url.searchParams);
  const locale = await getLocale(request);
  const posts = await listBlogPosts({ page, pageSize: BLOG_PAGE_SIZE, locale }).catch(
    cmsUnavailable,
  );
  if (page > posts.pageCount && posts.total > 0) {
    throw data(null, { status: 404 });
  }
  return data(buildBlogListView(posts, locale), { headers: blogCacheHeaders(request) });
}

export default function Blog({ loaderData }: Route.ComponentProps) {
  const { t, locale } = useT();
  const path = usePathFor();
  const { posts, page, pageCount } = loaderData;
  const navigation = useNavigation();
  // Dim the list while another page of it loads.
  const busy = navigation.state === "loading" && navigation.location.pathname === path("blog");

  return (
    <main className="container mx-auto px-4 pt-10 pb-16">
      <h1 className="text-4xl font-bold leading-tight tracking-[-0.01em] text-ink md:text-5xl">
        {t("blog.title")}
      </h1>
      <p className="mt-3 max-w-2xl text-lg text-body">{t("blog.intro")}</p>

      <section
        aria-label={t("blog.articles")}
        aria-busy={busy || undefined}
        className={cn("mt-8 transition-opacity duration-200", busy && "opacity-60")}
      >
        {posts.length > 0 ? (
          <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {posts.map((post) => (
              <li key={post.slug} className="flex">
                <BlogPostCard post={post} />
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-card-lg bg-blush p-8 text-center">
            <p className="text-lg font-bold text-ink">{t("blog.empty")}</p>
            <p className="mt-1 text-body">{t("blog.emptyHint")}</p>
            <div className="mt-4 flex flex-wrap justify-center gap-3">
              <ButtonLink to={path("catalog", { gender: "women" })} size="sm">
                {t("blog.shopWomen")}
              </ButtonLink>
              <ButtonLink to={path("catalog", { gender: "men" })} size="sm" variant="dark">
                {t("blog.shopMen")}
              </ButtonLink>
            </div>
          </div>
        )}
      </section>

      <div className="mt-10">
        <Pagination page={page} pageCount={pageCount} hrefForPage={(n) => blogHref(locale, n)} />
      </div>
    </main>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const { t } = useT();
  return <ErrorContent {...describeRouteError(error, t)} />;
}
