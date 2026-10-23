import { cn } from "~/lib/cn";

type RichTextProps = {
  /** HTML that was sanitized on the server (`renderMarkdown` in `app/.server/markdown.ts`). */
  html: string;
  className?: string;
};

/** Renders CMS rich text with basic typography for paragraphs, lists, headings and links. */
export function RichText({ html, className }: RichTextProps) {
  return (
    <div
      className={cn(
        "space-y-4 leading-relaxed",
        "[&_a]:font-semibold [&_a]:underline [&_a]:underline-offset-2",
        "[&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6",
        "[&_h3]:text-xl [&_h3]:font-bold [&_h4]:text-lg [&_h4]:font-bold",
        "[&_blockquote]:border-l-4 [&_blockquote]:border-primary-light [&_blockquote]:pl-4",
        className,
      )}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized server-side by renderMarkdown.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
