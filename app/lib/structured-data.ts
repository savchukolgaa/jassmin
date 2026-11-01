// schema.org structured data (JSON-LD) for Google rich results (#86). Pure builders that return
// plain objects from the loaders' DTOs; `<JsonLd>` (`app/components/JsonLd.tsx`) renders them.
// Isomorphic: no server imports. Never add ratings or reviews: the shop has none.
import type { BlogPostView } from "./blog";
import type { SocialLink } from "./cms";
import type { Locale } from "./i18n";
import type { ProductDetail, ProductVariant } from "./products";

export const SCHEMA_CONTEXT = "https://schema.org";
export const STORE_NAME = "Jassmin";
export const PRICE_CURRENCY = "UAH";
/** Google shows at most this many characters of a `BlogPosting` headline. */
export const HEADLINE_MAX_LENGTH = 110;

// --- schema.org types (only the properties we emit) ---

export interface OrganizationRefLd {
  "@type": "Organization";
  name: string;
  url?: string;
}

export interface IdRefLd {
  "@id": string;
}

export interface OfferLd {
  "@type": "Offer";
  name: string;
  price: string;
  priceCurrency: typeof PRICE_CURRENCY;
  availability: "https://schema.org/InStock" | "https://schema.org/OutOfStock";
  itemCondition: "https://schema.org/NewCondition";
  url: string;
  seller: OrganizationRefLd;
}

export interface ProductLd {
  "@context": typeof SCHEMA_CONTEXT;
  "@type": "Product";
  name: string;
  brand: { "@type": "Brand"; name: string };
  url: string;
  sku?: string;
  image?: string;
  description?: string;
  offers: OfferLd[];
}

export interface ListItemLd {
  "@type": "ListItem";
  position: number;
  name: string;
  item: string;
}

export interface BreadcrumbListLd {
  "@context": typeof SCHEMA_CONTEXT;
  "@type": "BreadcrumbList";
  itemListElement: ListItemLd[];
}

export interface PostalAddressLd {
  "@type": "PostalAddress";
  streetAddress: string;
  addressLocality?: string;
  postalCode?: string;
  addressCountry: "UA";
}

export interface GeoCoordinatesLd {
  "@type": "GeoCoordinates";
  latitude: number;
  longitude: number;
}

export interface PerfumeStoreLd {
  "@type": "PerfumeStore";
  "@id": string;
  name: string;
  url: string;
  image?: string;
  telephone: string;
  email: string;
  address: PostalAddressLd;
  geo?: GeoCoordinatesLd;
  openingHours?: string[];
  hasMap?: string;
  sameAs?: string[];
}

export interface WebSiteLd {
  "@type": "WebSite";
  "@id": string;
  name: string;
  url: string;
  inLanguage: Locale;
  publisher: IdRefLd;
}

export interface StoreGraphLd {
  "@context": typeof SCHEMA_CONTEXT;
  "@graph": [PerfumeStoreLd, WebSiteLd];
}

export interface BlogPostingLd {
  "@context": typeof SCHEMA_CONTEXT;
  "@type": "BlogPosting";
  headline: string;
  description?: string;
  image?: string;
  datePublished: string;
  dateModified: string;
  author: { "@type": "Person"; name: string } | OrganizationRefLd;
  publisher: OrganizationRefLd;
  inLanguage: Locale;
  mainEntityOfPage: string;
}

export type StructuredData = ProductLd | BreadcrumbListLd | StoreGraphLd | BlogPostingLd;

// --- serialization ---

/**
 * JSON for a `<script type="application/ld+json">`. Every `<` becomes `<`, so CMS text such
 * as `</script>` can't close the script tag; U+2028/U+2029 are escaped too. `JSON.parse` of the
 * result still gives back the input.
 */
export function serializeJsonLd(data: StructuredData): string {
  return JSON.stringify(data)
    .replaceAll("<", String.raw`\u003c`)
    .replaceAll(String.fromCharCode(0x2028), String.raw`\u2028`)
    .replaceAll(String.fromCharCode(0x2029), String.raw`\u2029`);
}

// --- URLs ---

/**
 * An absolute URL for `pathOrUrl` on the public site `origin`. Absolute `http(s)` URLs (Strapi
 * media) are kept as they are.
 */
export function absoluteUrl(origin: string, pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl;
  }
  return new URL(pathOrUrl, `${origin.replace(/\/+$/, "")}/`).href;
}

function sellerLd(origin: string): OrganizationRefLd {
  return { "@type": "Organization", name: STORE_NAME, url: absoluteUrl(origin, "/") };
}

// --- Product ---

export interface ProductLdInput {
  origin: string;
  product: Pick<
    ProductDetail,
    "title" | "brand" | "imageUrl" | "description" | "storeCode" | "packSize"
  > & { variants: Pick<ProductVariant, "volumeMl" | "price" | "inStock">[] };
  /** The product page's path, e.g. `/products/<id>`. */
  path: string;
  /** The translated name of a size, e.g. `50 мл` (`formatVolume`). */
  variantName: (variant: Pick<ProductVariant, "volumeMl">) => string;
}

/**
 * A `Product` with one `Offer` per size, or `null` when the product has no sizes: Google reports a
 * `Product` without offers, reviews or ratings as an error, and we never invent ratings.
 */
export function productLd({
  origin,
  product,
  path,
  variantName,
}: ProductLdInput): ProductLd | null {
  if (product.variants.length === 0) {
    return null;
  }
  const url = absoluteUrl(origin, path);
  const seller = sellerLd(origin);
  const description = product.description?.trim();
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "Product",
    name: product.title,
    brand: { "@type": "Brand", name: product.brand },
    url,
    ...(product.storeCode ? { sku: product.storeCode } : {}),
    ...(product.imageUrl ? { image: absoluteUrl(origin, product.imageUrl) } : {}),
    ...(description ? { description } : {}),
    offers: product.variants.map((variant) => ({
      "@type": "Offer",
      name: variantName(variant),
      price: variant.price,
      priceCurrency: PRICE_CURRENCY,
      availability: variant.inStock
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
      itemCondition: "https://schema.org/NewCondition",
      url,
      seller,
    })),
  };
}

// --- Breadcrumbs ---

export interface Breadcrumb {
  /** Translated name. */
  name: string;
  /** Site path without a query string, e.g. `/catalog/women`. */
  to: string;
}

export function breadcrumbListLd(origin: string, items: readonly Breadcrumb[]): BreadcrumbListLd {
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "BreadcrumbList",
    itemListElement: items.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: absoluteUrl(origin, crumb.to),
    })),
  };
}

// --- Opening hours ---

const SCHEMA_DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"] as const;
type SchemaDay = (typeof SCHEMA_DAYS)[number];

// Abbreviations and full names, lowercased, with apostrophes removed.
const DAY_NAMES: Record<SchemaDay, readonly string[]> = {
  Mo: ["пн", "пон", "понеділок", "mo", "mon", "monday"],
  Tu: ["вт", "вів", "вівторок", "tu", "tue", "tues", "tuesday"],
  We: ["ср", "сер", "середа", "we", "wed", "wednesday"],
  Th: ["чт", "чет", "четвер", "th", "thu", "thur", "thurs", "thursday"],
  Fr: ["пт", "птн", "пятниця", "fr", "fri", "friday"],
  Sa: ["сб", "суб", "субота", "sa", "sat", "saturday"],
  Su: ["нд", "нед", "неділя", "su", "sun", "sunday"],
};
const EVERY_DAY = ["щодня", "щоденно", "daily", "every day", "everyday"];

const DAY_LOOKUP = new Map<string, SchemaDay>(
  SCHEMA_DAYS.flatMap((day) => DAY_NAMES[day].map((name) => [name, day] as const)),
);

function toDay(token: string): SchemaDay | undefined {
  return DAY_LOOKUP.get(
    token
      .toLowerCase()
      .replace(/['’ʼ`.]/g, "")
      .trim(),
  );
}

const DASH = "[-–—]";
const TIME = "(\\d{1,2})[:.](\\d{2})";
const LINE = new RegExp(`^(.+?)[:\\s]\\s*${TIME}\\s*${DASH}\\s*${TIME}$`);

function toTime(hours: string, minutes: string): string | undefined {
  const h = Number(hours);
  const m = Number(minutes);
  if (h > 24 || m > 59 || (h === 24 && m !== 0)) {
    return undefined;
  }
  return `${String(h).padStart(2, "0")}:${minutes}`;
}

function toDays(text: string): string | undefined {
  const normalized = text.trim().toLowerCase().replace(/:$/, "").trim();
  if (EVERY_DAY.includes(normalized)) {
    return "Mo-Su";
  }
  const parts = normalized.split(",").map((part) => part.trim());
  const ranges: string[] = [];
  for (const part of parts) {
    const ends = part.split(new RegExp(`\\s*${DASH}\\s*`));
    const days = ends.map(toDay);
    if (days.length === 1 && days[0]) {
      ranges.push(days[0]);
    } else if (days.length === 2 && days[0] && days[1]) {
      ranges.push(`${days[0]}-${days[1]}`);
    } else {
      return undefined;
    }
  }
  return ranges.join(",");
}

/**
 * schema.org `openingHours` from the free-text hours staff type in Strapi, one range per line:
 * `Пн–Пт 10:00–20:00` → `Mo-Fr 10:00-20:00`. Understands Ukrainian and English day names,
 * comma-separated days, "щодня"/"daily" and any dash. Lines it can't read (e.g. "Нд — вихідний")
 * are left out.
 */
export function parseOpeningHours(text: string | null | undefined): string[] {
  if (!text) {
    return [];
  }
  const result: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const match = LINE.exec(raw.trim());
    if (!match) {
      continue;
    }
    const [, dayText = "", openH = "", openM = "", closeH = "", closeM = ""] = match;
    const days = toDays(dayText);
    const opens = toTime(openH, openM);
    const closes = toTime(closeH, closeM);
    if (days && opens && closes) {
      result.push(`${days} ${opens}-${closes}`);
    }
  }
  return result;
}

// --- Store (home page) ---

export interface StoreLocationInput {
  /** The one-line address shown on the page; the fallback `streetAddress`. */
  address: string;
  openingHours: string | null;
  streetAddress: string | null;
  addressLocality: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  directionsUrl: string | null;
}

export interface StoreGraphLdInput {
  origin: string;
  locale: Locale;
  location: StoreLocationInput;
  contacts: { phone: string; email: string; socialLinks: readonly SocialLink[] };
  /** An absolute or site-relative photo of the store. */
  image: string | null;
}

function postalAddressLd(location: StoreLocationInput): PostalAddressLd {
  const street = location.streetAddress?.trim();
  const locality = location.addressLocality?.trim();
  const postalCode = location.postalCode?.trim();
  return {
    "@type": "PostalAddress",
    streetAddress: street || location.address,
    ...(street && locality ? { addressLocality: locality } : {}),
    ...(street && postalCode ? { postalCode } : {}),
    addressCountry: "UA",
  };
}

function geoLd({ latitude, longitude }: StoreLocationInput): GeoCoordinatesLd | undefined {
  if (
    latitude === null ||
    longitude === null ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  ) {
    return undefined;
  }
  return { "@type": "GeoCoordinates", latitude, longitude };
}

/** The store's `@id`, which other nodes (website, blog publisher) can point to. */
export function storeId(origin: string): string {
  return `${absoluteUrl(origin, "/")}#store`;
}

/** The home page's `@graph`: the shop as a `PerfumeStore` (an Organization) and the `WebSite`. */
export function storeGraphLd({
  origin,
  locale,
  location,
  contacts,
  image,
}: StoreGraphLdInput): StoreGraphLd {
  const home = absoluteUrl(origin, "/");
  const openingHours = parseOpeningHours(location.openingHours);
  const geo = geoLd(location);
  const sameAs = contacts.socialLinks.map((link) => link.url);
  return {
    "@context": SCHEMA_CONTEXT,
    "@graph": [
      {
        "@type": "PerfumeStore",
        "@id": storeId(origin),
        name: STORE_NAME,
        url: home,
        ...(image ? { image: absoluteUrl(origin, image) } : {}),
        telephone: contacts.phone,
        email: contacts.email,
        address: postalAddressLd(location),
        ...(geo ? { geo } : {}),
        ...(openingHours.length > 0 ? { openingHours } : {}),
        ...(location.directionsUrl ? { hasMap: location.directionsUrl } : {}),
        ...(sameAs.length > 0 ? { sameAs } : {}),
      },
      {
        "@type": "WebSite",
        "@id": `${home}#website`,
        name: STORE_NAME,
        url: home,
        inLanguage: locale,
        publisher: { "@id": storeId(origin) },
      },
    ],
  };
}

// --- Blog post ---

/** Cuts `text` to at most `max` characters on a word boundary, ending with "…" when cut. */
export function truncateWords(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  const cut = trimmed.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export interface BlogPostingLdInput {
  origin: string;
  post: Pick<
    BlogPostView,
    "title" | "locale" | "authorName" | "coverImage" | "publishedAt" | "updatedAt" | "seo"
  >;
  /** The post's absolute canonical URL. */
  url: string;
}

export function blogPostingLd({ origin, post, url }: BlogPostingLdInput): BlogPostingLd {
  const image = post.seo.image ?? post.coverImage?.url ?? null;
  const description = post.seo.description.trim();
  const author = post.authorName?.trim();
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "BlogPosting",
    headline: truncateWords(post.title, HEADLINE_MAX_LENGTH),
    ...(description ? { description } : {}),
    ...(image ? { image: absoluteUrl(origin, image) } : {}),
    datePublished: post.publishedAt,
    dateModified: post.updatedAt,
    author: author ? { "@type": "Person", name: author } : sellerLd(origin),
    publisher: sellerLd(origin),
    inLanguage: post.locale,
    mainEntityOfPage: url,
  };
}
