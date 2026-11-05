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

/** The words of a text part, without a trailing `:` (the HTML has `label: value` as two cells). */
export function words(text: string): string[] {
  return text
    .split(/\s+/u)
    .map((word) => word.replace(/:$/, ""))
    .filter(Boolean);
}

/** The words of an HTML fragment once its tags are gone, to compare with `words(text)`. */
export function htmlWords(html: string): string[] {
  return words(htmlToText(html));
}
