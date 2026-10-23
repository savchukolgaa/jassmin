import { Marked } from "marked";
import sanitizeHtml from "sanitize-html";

// Renders editor-written Markdown from Strapi (home page "About us", blog articles in #13) to HTML
// on the server. The output is sanitized, so routes may inject it with `dangerouslySetInnerHTML`.

const marked = new Marked({ gfm: true, breaks: false });

const transformLink: sanitizeHtml.Transformer = (tagName, attribs) => {
  const external = /^https?:\/\//i.test(attribs.href ?? "");
  return {
    tagName,
    attribs: external ? { ...attribs, target: "_blank", rel: "noopener noreferrer" } : attribs,
  };
};

const BASIC_TAGS = ["p", "br", "strong", "em", "ul", "ol", "li", "a", "h3", "h4", "blockquote"];

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: BASIC_TAGS,
  allowedAttributes: { a: ["href", "title", "target", "rel"] },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowProtocolRelative: false,
  transformTags: { a: transformLink },
};

/** Markdown → sanitized HTML: only basic text formatting and safe links survive. */
export function renderMarkdown(markdown: string): string {
  const html = marked.parse(markdown, { async: false });
  return sanitizeHtml(html, SANITIZE_OPTIONS);
}

/** Resolves an image path against `baseUrl`; `null` when it isn't a valid URL. */
function resolveImageSrc(src: string, baseUrl: string): string | null {
  try {
    return new URL(src, baseUrl).toString();
  } catch {
    return null;
  }
}

function articleSanitizeOptions(mediaBaseUrl: string): sanitizeHtml.IOptions {
  return {
    ...SANITIZE_OPTIONS,
    allowedTags: [...BASIC_TAGS, "h2", "hr", "code", "pre", "del", "img"],
    allowedAttributes: {
      ...SANITIZE_OPTIONS.allowedAttributes,
      img: ["src", "alt", "title", "width", "height", "loading", "decoding"],
    },
    allowedSchemesByTag: { img: ["http", "https"] },
    transformTags: {
      ...SANITIZE_OPTIONS.transformTags,
      // The page's `h1` is the article title.
      h1: "h2",
      // Strapi stores uploads as `/uploads/…`, relative to the CMS origin, not to this site.
      img: (tagName, attribs) => {
        const { src, ...rest } = attribs;
        const resolved = src ? resolveImageSrc(src, mediaBaseUrl) : null;
        return {
          tagName,
          attribs: {
            ...(resolved ? { src: resolved } : {}),
            ...rest,
            loading: "lazy",
            decoding: "async",
          },
        };
      },
    },
    // Drop images whose `src` was missing, invalid or used a disallowed scheme.
    exclusiveFilter: (frame) => frame.tag === "img" && !frame.attribs.src,
  };
}

/**
 * Markdown → sanitized HTML for blog articles (#13): like `renderMarkdown`, plus `h2` headings,
 * code, rules and images. Relative image paths are resolved against `mediaBaseUrl` (the Strapi
 * origin), and only `http`/`https` images survive.
 */
export function renderArticleMarkdown(
  markdown: string,
  { mediaBaseUrl }: { mediaBaseUrl: string },
): string {
  const html = marked.parse(markdown, { async: false });
  return sanitizeHtml(html, articleSanitizeOptions(mediaBaseUrl));
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code.startsWith("#x") || code.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
    }
    if (code.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

/**
 * Markdown → plain text for meta descriptions: no tags, whitespace collapsed, cut at a word
 * boundary to at most `maxLength` characters (with "…" when cut).
 */
export function toPlainText(markdown: string, maxLength = 160): string {
  const html = marked.parse(markdown, { async: false });
  const text = decodeEntities(sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }))
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxLength) {
    return text;
  }
  const cut = text.slice(0, maxLength - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
