import { Link } from "react-router";
import { focusRing } from "~/components/layout/nav";
import { type BlogPostCardView, blogPostHref } from "~/lib/blog";
import { useContentLang } from "~/lib/i18n";
import { BlogCover } from "./BlogCover";

/** One article in the `/blog` list: cover, date, title and excerpt. */
export function BlogPostCard({ post }: { post: BlogPostCardView }) {
  const href = blogPostHref(post.slug);
  const lang = useContentLang(post.locale);

  return (
    <article className="lift flex w-full flex-col rounded-card bg-white p-3 ring-1 ring-line">
      {/* The title link is the one in the tab order; the cover is a mouse shortcut. */}
      <Link to={href} tabIndex={-1} aria-hidden="true">
        <BlogCover
          image={post.coverImage}
          sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
        />
      </Link>
      <div className="flex flex-1 flex-col gap-2 px-2 pt-4 pb-2">
        <p className="text-sm font-bold text-muted">
          <time dateTime={post.publishedAt}>{post.publishedLabel}</time>
        </p>
        <h2
          className="text-xl font-extrabold leading-tight tracking-[-0.03em] text-ink"
          lang={lang}
        >
          <Link to={href} className={`rounded hover:underline ${focusRing("onLight")}`}>
            {post.title}
          </Link>
        </h2>
        {post.excerpt && (
          <p className="text-body" lang={lang}>
            {post.excerpt}
          </p>
        )}
      </div>
    </article>
  );
}
