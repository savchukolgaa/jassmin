import { cn } from "~/lib/cn";

type RichTextProps = {
  /**
   * HTML that was sanitized on the server (`renderMarkdown` / `renderArticleMarkdown` in
   * `app/.server/markdown.ts`).
   */
  html: string;
  /** `article` adds styles for blog content: `h2`, images, rules and code. */
  variant?: "basic" | "article";
  className?: string;
};

// Blog articles (#13): larger body text, `h2` section headings, images, rules and code.
const ARTICLE_CLASSES = cn(
  "text-lg text-body [&_a]:text-primary-dark",
  "[&_h2]:pt-4 [&_h2]:text-3xl [&_h2]:font-extrabold [&_h2]:leading-tight",
  "[&_h2]:tracking-[-0.03em] [&_h2]:text-ink [&_h3]:pt-2 [&_h3]:text-ink [&_h4]:text-ink",
  "[&_img]:h-auto [&_img]:w-full [&_img]:rounded-card",
  "[&_hr]:my-8 [&_hr]:border-line",
  "[&_code]:rounded [&_code]:bg-card [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-base",
  "[&_pre]:overflow-x-auto [&_pre]:rounded-card [&_pre]:bg-card [&_pre]:p-4",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
);

/** Renders CMS rich text with basic typography for paragraphs, lists, headings and links. */
export function RichText({ html, variant = "basic", className }: RichTextProps) {
  return (
    <div
      className={cn(
        "space-y-4 leading-relaxed",
        "[&_a]:font-semibold [&_a]:underline [&_a]:underline-offset-2",
        "[&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6",
        "[&_h3]:text-xl [&_h3]:font-bold [&_h4]:text-lg [&_h4]:font-bold",
        "[&_blockquote]:border-l-4 [&_blockquote]:border-primary [&_blockquote]:pl-4",
        variant === "article" && ARTICLE_CLASSES,
        className,
      )}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized server-side in app/.server/markdown.ts.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
