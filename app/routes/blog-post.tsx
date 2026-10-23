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
import type { Route } from "./+types/blog-post";

export function meta({ loaderData, matches }: Route.MetaArgs) {
  const { t } = metaTranslator(matches);
  if (!loaderData) {
    return [{ title: t("meta.title", { page: t("blog.notFound") }) }];
  }
  const { seo, publishedAt } = loaderData;
  const title = t("meta.title", { page: seo.title });
  return [
    { title },
    { name: "description", content: seo.description },
    { property: "og:type", content: "article" },
    { property: "og:title", content: seo.title },
    { property: "og:description", content: seo.description },
    { property: "og:url", content: seo.canonicalUrl },
    { property: "article:published_time", content: publishedAt },
    ...(seo.image
      ? [
          { property: "og:image", content: seo.image },
          { name: "twitter:card", content: "summary_large_image" },
        ]
      : []),
    { tagName: "link", rel: "canonical", href: seo.canonicalUrl },
  ];
}

export function headers({ loaderHeaders }: Route.HeadersArgs) {
  return blogResponseHeaders(loaderHeaders);
}

// A published Strapi post. Drafts and unknown slugs are 404s (the CMS client only ever asks for
// published content); an outage becomes a 503.
export async function loader({ params, request }: Route.LoaderArgs) {
  if (!isBlogSlug(params.slug)) {
    throw data(null, { status: 404 });
  }
  const [post, locale] = await Promise.all([
    getBlogPostBySlug(params.slug).catch(cmsUnavailable),
    getLocale(request),
  ]);
  if (!post) {
    throw data(null, { status: 404 });
  }
  const view = buildBlogPostView(post, {
    origin: new URL(request.url).origin,
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
