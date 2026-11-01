import { Link } from "react-router";
import { Breadcrumbs } from "~/components/layout/Breadcrumbs";
import { focusRing } from "~/components/layout/nav";
import { RichText } from "~/components/ui/RichText";
import type { BlogPostView } from "~/lib/blog";
import { blogPostBreadcrumbs } from "~/lib/breadcrumbs";
import { useContentLang, useT } from "~/lib/i18n";
import { BlogCover } from "./BlogCover";

/** Link back to the article list, shown on an article's error page. */
export function BackToBlogLink() {
  const { t } = useT();

  return (
    <Link
      to="/blog"
      className={`inline-flex min-h-11 items-center rounded-pill font-bold text-primary-dark underline-offset-2 hover:underline ${focusRing("onLight")}`}
    >
      {t("blog.back")}
    </Link>
  );
}

/** The `/blog/:slug` page body: title, date and author, cover and the sanitized article. */
export function BlogArticle({ post }: { post: BlogPostView }) {
  const { t } = useT();
  const lang = useContentLang(post.locale);

  return (
    <main className="container mx-auto px-4 pt-6 pb-16">
      <article className="mx-auto max-w-3xl">
        <Breadcrumbs items={blogPostBreadcrumbs(t, post)} />
        <header className="mt-4">
          <h1
            className="text-4xl font-bold leading-tight tracking-[-0.01em] text-ink md:text-5xl"
            lang={lang}
          >
            {post.title}
          </h1>
          <p className="mt-3 text-sm font-bold text-muted">
            <time dateTime={post.publishedAt}>{post.publishedLabel}</time>
            {post.authorName && <> · {post.authorName}</>}
          </p>
          {post.excerpt && (
            <p className="mt-4 text-lg text-body" lang={lang}>
              {post.excerpt}
            </p>
          )}
        </header>
        {post.coverImage && (
          <BlogCover
            image={post.coverImage}
            sizes="(min-width: 768px) 768px, 100vw"
            eager
            className="mt-8 rounded-card-lg"
          />
        )}
        <RichText
          variant="article"
          html={post.contentHtml}
          lang={lang}
          className="mx-auto mt-10 max-w-prose"
        />
      </article>
    </main>
  );
}
