import { data, useNavigation } from "react-router";
import { listBlogPosts } from "~/.server/cms/content";
import { cmsUnavailable } from "~/.server/cms/errors";
import { blogCacheHeaders, buildBlogListView } from "~/.server/services/blog";
import { ErrorContent } from "~/components/layout/ErrorContent";
import { ButtonLink } from "~/components/ui/ButtonLink";
import { Pagination } from "~/components/ui/Pagination";
import { BlogPostCard } from "~/features/blog/BlogPostCard";
import {
  BLOG_PAGE_SIZE,
  blogHref,
  blogResponseHeaders,
  DEFAULT_BLOG_DESCRIPTION,
  parseBlogSearch,
} from "~/lib/blog";
import { cn } from "~/lib/cn";
import { useT } from "~/lib/i18n";
import { describeRouteError } from "~/lib/route-error";
import type { Route } from "./+types/blog";

export function meta({ loaderData }: Route.MetaArgs) {
  const page = loaderData?.page ?? 1;
  const title = page > 1 ? `Blog — Page ${page} — Jassmin` : "Blog — Jassmin";
  return [
    { title },
    { name: "description", content: DEFAULT_BLOG_DESCRIPTION },
    { property: "og:type", content: "website" },
    { property: "og:title", content: title },
    { property: "og:description", content: DEFAULT_BLOG_DESCRIPTION },
    ...(loaderData
      ? [
          { property: "og:url", content: loaderData.canonicalUrl },
          { tagName: "link", rel: "canonical", href: loaderData.canonicalUrl },
        ]
      : []),
  ];
}

export function headers({ loaderHeaders }: Route.HeadersArgs) {
  return blogResponseHeaders(loaderHeaders);
}

// Published Strapi posts, newest first. A page past the end is a 404; an outage becomes a 503.
export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const { page } = parseBlogSearch(url.searchParams);
  const posts = await listBlogPosts({ page, pageSize: BLOG_PAGE_SIZE }).catch(cmsUnavailable);
  if (page > posts.pageCount && posts.total > 0) {
    throw data(null, { status: 404 });
  }
  return data(
    {
      ...buildBlogListView(posts),
      canonicalUrl: new URL(blogHref(page), url.origin).toString(),
    },
    { headers: blogCacheHeaders(request) },
  );
}

export default function Blog({ loaderData }: Route.ComponentProps) {
  const { posts, page, pageCount } = loaderData;
  const navigation = useNavigation();
  // Dim the list while another page of it loads.
  const busy = navigation.state === "loading" && navigation.location.pathname === "/blog";

  return (
    <main className="container mx-auto px-4 pt-10 pb-16">
      <h1 className="text-4xl font-extrabold leading-tight tracking-[-0.04em] text-ink md:text-5xl">
        Blog
      </h1>
      <p className="mt-3 max-w-2xl text-lg text-body">
        Scent guides and fragrance stories to help you find a perfume that suits you.
      </p>

      <section
        aria-label="Articles"
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
            <p className="text-lg font-bold text-ink">No articles yet.</p>
            <p className="mt-1 text-body">In the meantime, have a look at our perfumes.</p>
            <div className="mt-4 flex flex-wrap justify-center gap-3">
              <ButtonLink to="/catalog/women" size="sm">
                Shop women
              </ButtonLink>
              <ButtonLink to="/catalog/men" size="sm" variant="dark">
                Shop men
              </ButtonLink>
            </div>
          </div>
        )}
      </section>

      <div className="mt-10">
        <Pagination page={page} pageCount={pageCount} hrefForPage={blogHref} />
      </div>
    </main>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const { t } = useT();
  return <ErrorContent {...describeRouteError(error, t)} />;
}
