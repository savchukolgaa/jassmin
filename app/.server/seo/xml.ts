// Text helpers for the XML the server builds: the sitemap (#87) and the product feeds (#140).

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

/** Escapes text for an XML element or a quoted attribute. */
export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => XML_ESCAPES[char] ?? char);
}

/**
 * Characters XML 1.0 forbids even escaped: C0 controls other than tab, LF and CR, U+FFFE/U+FFFF,
 * and surrogates without their pair. CMS text can contain them, and one would break the document.
 */
const INVALID_XML_CHARS =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point.
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** `value` without the characters XML forbids, escaped for an element or a quoted attribute. */
export function xmlText(value: string): string {
  return escapeXml(value.replace(INVALID_XML_CHARS, ""));
}
