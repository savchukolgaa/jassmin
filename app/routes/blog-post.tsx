import { data } from "react-router";
import { getBlogPostBySlug } from "~/.server/cms/content";
import { cmsUnavailable } from "~/.server/cms/errors";
import { getEnv } from "~/.server/env";
import { getLocale } from "~/.server/locale";
import { blogCacheHeaders, buildBlogPostView } from "~/.server/services/blog";
import { ErrorContent } from "~/components/layout/ErrorContent";
import { BackToBlogLink, BlogArticle } from "~/features/blog/BlogArticle";
import { blogResponseHeaders, isBlogSlug } from "~/lib/blog";
import { metaTranslator, useT } from "~/lib/i18n";
import { describeRouteError } from "~/lib/route-error";
import { errorMeta, seoMeta } from "~/lib/seo";
import type { Route } from "./+types/blog-post";

export function meta({ loaderData, matches, location, error }: Route.MetaArgs) {
  const { t } = metaTranslator(matches);
  if (error || !loaderData) {
    return errorMeta({ matches, error, notFoundTitle: t("blog.notFound") });
  }
  const { seo, publishedAt } = loaderData;
  return seoMeta(
    { matches, location },
    {
      title: t("meta.title", { page: seo.title }),
      description: seo.description,
      type: "article",
      image: seo.image ? { url: seo.image, alt: seo.title } : null,
      extra: [{ property: "article:published_time", content: publishedAt }],
    },
  );
}

export function headers({ loaderHeaders }: Route.HeadersArgs) {
  return blogResponseHeaders(loaderHeaders);
}

// A published Strapi post, in the visitor's language or else in Ukrainian (the slug is the same in
// both). Drafts and unknown slugs are 404s (the CMS client only ever asks for
// published content); an outage becomes a 503.
export async function loader({ params, request }: Route.LoaderArgs) {
  if (!isBlogSlug(params.slug)) {
    throw data(null, { status: 404 });
  }
  const locale = await getLocale(request);
  const post = await getBlogPostBySlug(params.slug, locale).catch(cmsUnavailable);
  if (!post) {
    throw data(null, { status: 404 });
  }
  const view = buildBlogPostView(post, {
    mediaBaseUrl: getEnv().STRAPI_URL,
    locale,
  });
  return data(view, { headers: blogCacheHeaders(request) });
}

export default function BlogPost({ loaderData }: Route.ComponentProps) {
  return <BlogArticle post={loaderData} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const { t } = useT();
  return (
    <ErrorContent {...describeRouteError(error, t)}>
      <div className="mt-4">
        <BackToBlogLink />
      </div>
    </ErrorContent>
  );
}
