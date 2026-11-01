import { type StructuredData, serializeJsonLd } from "~/lib/structured-data";

/** A schema.org JSON-LD block for search engines (#86). Google reads it anywhere in the page. */
export function JsonLd({ data }: { data: StructuredData }) {
  return (
    <script
      type="application/ld+json"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: `serializeJsonLd` escapes every `<`, so CMS text can't close the tag; a text child would be HTML-escaped and break the JSON.
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
