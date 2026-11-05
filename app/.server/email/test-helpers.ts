// Helpers for tests of emails built with the shared layout (#134).

/** The HTML between the layout's `<!--name-->` and `<!--/name-->` markers. */
export function htmlSection(html: string, name: "content" | "footer"): string {
  const start = html.indexOf(`<!--${name}-->`);
  const end = html.indexOf(`<!--/${name}-->`);
  if (start === -1 || end === -1) {
    throw new Error(`No ${name} section in the email`);
  }
  return html.slice(start + `<!--${name}-->`.length, end);
}

/** HTML as plain text: tags dropped, entities decoded. */
export function htmlToText(html: string): string {
  return html
    .replace(/<br>/g, "\n")
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

/**
 * The words of a text part, or of an HTML fragment once its tags are gone, so the two parts can be
 * compared: the text part's `label: value` is two table cells in the HTML.
 */
export function words(content: string): string[] {
  const text = content.includes("<") ? htmlToText(content) : content;
  return text
    .split(/\s+/u)
    .map((word) => word.replace(/:$/, ""))
    .filter(Boolean);
}
