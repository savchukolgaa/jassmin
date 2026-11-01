import { z } from "zod";
import type {
  BlogPost,
  BlogPostSummary,
  CmsImage,
  HomePage,
  Offer,
  Paginated,
  Seo,
  SiteSettings,
} from "~/lib/cms";
import { DEFAULT_LOCALE, isLocale, LOCALES, type Locale } from "~/lib/i18n";
import { getEnv } from "../env";
import { cmsFetch, type StrapiQuery } from "./client";
import { isCmsError } from "./errors";
import {
  type BlogPostEntry,
  type BlogPostSummaryEntry,
  blogPostEntry,
  blogPostSummaryEntry,
  collectionResponse,
  type HomePageEntry,
  homePageEntry,
  type OfferEntry,
  offerEntry,
  type PaginationMeta,
  type SiteSettingEntry,
  type StrapiMedia,
  singleResponse,
  siteSettingEntry,
} from "./schemas";

// Content queries for route loaders. They return app DTOs from `~/lib/cms`, never raw Strapi
// shapes, and throw `CmsError` when Strapi is unavailable (wrap calls with `cmsUnavailable`).
// Each takes the visitor's locale (#43). Ukrainian is the source of truth: when the English
// translation of an entry is missing, the Ukrainian version is returned, and the DTO's `locale`
// says which one it is.

export const DEFAULT_PAGE_SIZE = 12;
export const MAX_PAGE_SIZE = 50;

const listBlogPostsInput = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  locale: z.enum(LOCALES).default(DEFAULT_LOCALE),
});

export type ListBlogPostsInput = z.input<typeof listBlogPostsInput>;

/** Both cover image fields of a post (#80); `pickImage` chooses between them. */
const BLOG_COVER_POPULATE = ["coverImage", "coverImageLocalized"];

/**
 * Builds an `srcset` from Strapi's resized formats and the original image, smallest first.
 * Returns `null` when no candidate has a known width.
 */
export function toSrcSet(media: StrapiMedia, baseUrl: string): string | null {
  const candidates = new Map<number, string>();
  for (const format of Object.values(media.formats ?? {})) {
    candidates.set(format.width, format.url);
  }
  if (media.width) {
    candidates.set(media.width, media.url);
  }
  if (candidates.size === 0) {
    return null;
  }
  return [...candidates]
    .sort(([a], [b]) => a - b)
    .map(([width, url]) => `${new URL(url, baseUrl).toString()} ${width}w`)
    .join(", ");
}

/** Resolves Strapi's relative `/uploads/…` URLs against the CMS origin. */
export function toImage(media: StrapiMedia | null | undefined, baseUrl: string): CmsImage | null {
  if (!media) {
    return null;
  }
  return {
    url: new URL(media.url, baseUrl).toString(),
    alt: media.alternativeText ?? "",
    width: media.width ?? null,
    height: media.height ?? null,
    srcSet: toSrcSet(media, baseUrl),
  };
}

/**
 * One image slot (#80): `shared` is the same in every locale, `localized` is the served
 * locale's override and `alt` its alt text.
 */
export interface ImageSlot {
  shared: StrapiMedia | null | undefined;
  localized: StrapiMedia | null | undefined;
  alt: string | null | undefined;
}

/**
 * The image to show for a slot: the locale's override when set, else the shared image, else
 * `null`. The entry's alt text describes whichever is shown; when it's blank, the file's own
 * alternative text is used.
 */
export function pickImage(slot: ImageSlot, baseUrl: string): CmsImage | null {
  const image = toImage(slot.localized ?? slot.shared, baseUrl);
  if (!image) {
    return null;
  }
  const alt = textOrNull(slot.alt);
  return alt ? { ...image, alt } : image;
}

/** The locale Strapi says it served the entry in, else the one that was asked for. */
function servedLocale(entry: { locale?: string | null }, requested: Locale): Locale {
  return isLocale(entry.locale) ? entry.locale : requested;
}

/** Optional Strapi text, trimmed; blank means not set. */
function textOrNull(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

function toSecondaryCta(
  label: string | null | undefined,
  href: string | null | undefined,
): HomePage["hero"]["secondaryCta"] {
  const text = textOrNull(label);
  const link = textOrNull(href);
  return text && link ? { label: text, href: link } : null;
}

export function toHomePage(
  entry: HomePageEntry,
  baseUrl: string,
  requested: Locale = DEFAULT_LOCALE,
): HomePage {
  const { hero, about, location } = entry;
  return {
    locale: servedLocale(entry, requested),
    hero: {
      headline: hero.headline,
      ctaLabel: hero.ctaLabel,
      ctaHref: hero.ctaHref,
      image: pickImage(
        { shared: entry.heroImage, localized: hero.imageLocalized, alt: hero.imageAlt },
        baseUrl,
      ),
      eyebrow: textOrNull(hero.eyebrow),
      subtitle: textOrNull(hero.subtitle),
      secondaryCta: toSecondaryCta(hero.secondaryCtaLabel, hero.secondaryCtaHref),
    },
    about: {
      title: about.title,
      body: about.body,
      image: pickImage(
        { shared: entry.aboutImage, localized: about.imageLocalized, alt: about.imageAlt },
        baseUrl,
      ),
    },
    location: {
      address: location.address,
      openingHours: location.openingHours ?? null,
      mapEmbedUrl: location.mapEmbedUrl,
    },
  };
}

export function toSiteSettings(
  entry: SiteSettingEntry,
  requested: Locale = DEFAULT_LOCALE,
): SiteSettings {
  return {
    locale: servedLocale(entry, requested),
    phone: entry.phone,
    email: entry.email,
    customerServiceHours: entry.customerServiceHours ?? null,
    legalName: entry.legalName?.trim() || null,
    socialLinks: (entry.socialLinks ?? []).map(({ platform, url }) => ({ platform, url })),
  };
}

export function toBlogPostSummary(
  entry: BlogPostSummaryEntry,
  baseUrl: string,
  requested: Locale = DEFAULT_LOCALE,
): BlogPostSummary {
  return {
    locale: servedLocale(entry, requested),
    slug: entry.slug,
    title: entry.title,
    excerpt: entry.excerpt ?? null,
    coverImage: pickImage(
      { shared: entry.coverImage, localized: entry.coverImageLocalized, alt: entry.coverImageAlt },
      baseUrl,
    ),
    authorName: entry.authorName ?? null,
    publishedAt: new Date(entry.publishedAt).toISOString(),
  };
}

export function toBlogPost(
  entry: BlogPostEntry,
  baseUrl: string,
  requested: Locale = DEFAULT_LOCALE,
): BlogPost {
  const seo: Seo | null = entry.seo
    ? {
        metaTitle: entry.seo.metaTitle ?? null,
        metaDescription: entry.seo.metaDescription ?? null,
        ogImage: toImage(entry.seo.ogImage, baseUrl),
      }
    : null;
  return { ...toBlogPostSummary(entry, baseUrl, requested), content: entry.content, seo };
}

export function toPaginated<T>(items: T[], { page, pageSize, pageCount, total }: PaginationMeta) {
  return { items, page, pageSize, pageCount, total } satisfies Paginated<T>;
}

/**
 * Reads an entry in `locale`, then in `DEFAULT_LOCALE` when `read` finds none (`null`) and
 * `locale` is another one. Errors aren't retried: an outage stays an outage.
 */
export async function withLocaleFallback<T>(
  locale: Locale,
  read: (locale: Locale) => Promise<T | null>,
): Promise<T | null> {
  const entry = await read(locale);
  if (entry !== null || locale === DEFAULT_LOCALE) {
    return entry;
  }
  return read(DEFAULT_LOCALE);
}

/** Strapi answers 404 for a single type that has no localization in the requested locale. */
function isNotFound(error: unknown): boolean {
  return isCmsError(error) && error.kind === "http" && error.status === 404;
}

/**
 * A single type in `locale`, falling back to `DEFAULT_LOCALE`. When there's no Ukrainian version
 * either, Strapi's 404 is rethrown as a `CmsError`, like any other CMS failure.
 */
async function getSingleType<T>(locale: Locale, read: (locale: Locale) => Promise<T>): Promise<T> {
  let notFound: unknown;
  const entry = await withLocaleFallback(locale, (l) =>
    read(l).catch((error: unknown) => {
      if (!isNotFound(error)) {
        throw error;
      }
      notFound = error;
      return null;
    }),
  );
  if (entry === null) {
    throw notFound;
  }
  return entry;
}

export async function getHomePage(locale: Locale = DEFAULT_LOCALE): Promise<HomePage> {
  const { data } = await getSingleType(locale, (l) =>
    cmsFetch(
      "home-page",
      {
        populate: {
          heroImage: true,
          aboutImage: true,
          hero: { populate: ["imageLocalized"] },
          about: { populate: ["imageLocalized"] },
          location: true,
        },
      },
      singleResponse(homePageEntry),
      { locale: l },
    ),
  );
  return toHomePage(data, getEnv().STRAPI_URL, locale);
}

export async function getSiteSettings(locale: Locale = DEFAULT_LOCALE): Promise<SiteSettings> {
  const { data } = await getSingleType(locale, (l) =>
    cmsFetch(
      "site-setting",
      { populate: { socialLinks: true } },
      singleResponse(siteSettingEntry),
      { locale: l },
    ),
  );
  return toSiteSettings(data, locale);
}

/**
 * Published posts, newest first. Pages are made of the Ukrainian posts, which always exist; in
 * another locale, each post on the page is swapped for its translation when it has one.
 */
export async function listBlogPosts(
  input: ListBlogPostsInput = {},
): Promise<Paginated<BlogPostSummary>> {
  const parsed = listBlogPostsInput.safeParse(input);
  if (!parsed.success) {
    throw new RangeError(`Invalid blog pagination: ${z.prettifyError(parsed.error)}`);
  }
  const { page, pageSize, locale } = parsed.data;

  const { data, meta } = await cmsFetch(
    "blog-posts",
    {
      sort: ["publishedAt:desc"],
      pagination: { page, pageSize },
      populate: BLOG_COVER_POPULATE,
    },
    collectionResponse(blogPostSummaryEntry),
    { locale: DEFAULT_LOCALE },
  );

  let entries = data;
  if (locale !== DEFAULT_LOCALE && data.length > 0) {
    const translations = await cmsFetch(
      "blog-posts",
      {
        filters: { documentId: { $in: data.map((entry) => entry.documentId) } },
        pagination: { page: 1, pageSize: data.length },
        populate: BLOG_COVER_POPULATE,
      },
      collectionResponse(blogPostSummaryEntry),
      { locale },
    );
    const byDocumentId = new Map(translations.data.map((entry) => [entry.documentId, entry]));
    entries = data.map((entry) => byDocumentId.get(entry.documentId) ?? entry);
  }

  const baseUrl = getEnv().STRAPI_URL;
  return toPaginated(
    entries.map((entry) => toBlogPostSummary(entry, baseUrl)),
    meta.pagination,
  );
}

/**
 * The published post with this slug, in `locale` or else in Ukrainian, or `null` when there is
 * none (a 404 for the route). Slugs are shared by all locales, so the URL is the same in each.
 */
export async function getBlogPostBySlug(
  slug: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<BlogPost | null> {
  if (slug.trim() === "") {
    return null;
  }

  const found = await withLocaleFallback(locale, async (l) => {
    const { data } = await cmsFetch(
      "blog-posts",
      {
        filters: { slug: { $eq: slug } },
        pagination: { page: 1, pageSize: 1 },
        populate: {
          coverImage: true,
          coverImageLocalized: true,
          seo: { populate: ["ogImage"] },
        },
      },
      collectionResponse(blogPostEntry),
      { locale: l },
    );
    const [entry] = data;
    return entry ? { entry, locale: l } : null;
  });
  return found ? toBlogPost(found.entry, getEnv().STRAPI_URL, found.locale) : null;
}

/** A UUID in any version: the shape of `products.public_id`. PostgreSQL rejects anything else. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `null` for a missing or blank optional text field. */
function optionalText(value: string | null | undefined): string | null {
  return value?.trim() ? value : null;
}

function toUtcIso(value: string | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null;
}

export function toOffer(
  entry: OfferEntry,
  baseUrl: string,
  requested: Locale = DEFAULT_LOCALE,
): Offer {
  const productIds = (entry.products ?? [])
    .map((product) => product.publicId.trim().toLowerCase())
    .filter((id) => UUID.test(id));
  return {
    locale: servedLocale(entry, requested),
    documentId: entry.documentId,
    slug: entry.slug,
    kind: entry.kind,
    title: entry.title,
    summary: optionalText(entry.summary),
    body: optionalText(entry.body),
    image: pickImage(
      { shared: entry.image, localized: entry.imageLocalized, alt: entry.imageAlt },
      baseUrl,
    ),
    startsAt: toUtcIso(entry.startsAt),
    endsAt: toUtcIso(entry.endsAt),
    priceNote: optionalText(entry.priceNote),
    productIds: [...new Set(productIds)],
    ctaLabel: optionalText(entry.ctaLabel),
    ctaUrl: optionalText(entry.ctaUrl),
    sortOrder: entry.sortOrder ?? 0,
  };
}

/** Whether `now` is in the offer's window: from `startsAt` (inclusive) to `endsAt` (exclusive). */
export function isOfferActive(offer: Pick<Offer, "startsAt" | "endsAt">, now: Date): boolean {
  const time = now.getTime();
  const started = offer.startsAt === null || Date.parse(offer.startsAt) <= time;
  const notEnded = offer.endsAt === null || time < Date.parse(offer.endsAt);
  return started && notEnded;
}

/**
 * Editor order: `sortOrder` ascending, then the most recently started first (offers without a
 * start last), then `documentId` so the order, and the hero, never depend on Strapi's tie-breaking.
 */
export function compareOffers(
  a: Pick<Offer, "sortOrder" | "startsAt" | "documentId">,
  b: Pick<Offer, "sortOrder" | "startsAt" | "documentId">,
): number {
  if (a.sortOrder !== b.sortOrder) {
    return a.sortOrder - b.sortOrder;
  }
  const aStart = a.startsAt === null ? Number.NEGATIVE_INFINITY : Date.parse(a.startsAt);
  const bStart = b.startsAt === null ? Number.NEGATIVE_INFINITY : Date.parse(b.startsAt);
  if (aStart !== bStart) {
    return bStart > aStart ? 1 : -1;
  }
  return a.documentId < b.documentId ? -1 : a.documentId > b.documentId ? 1 : 0;
}

/** Strapi filter for entries whose window includes the instant `nowIso`. */
function activeWindowFilter(nowIso: string): StrapiQuery {
  return {
    $and: [
      { $or: [{ startsAt: { $null: true } }, { startsAt: { $lte: nowIso } }] },
      { $or: [{ endsAt: { $null: true } }, { endsAt: { $gt: nowIso } }] },
    ],
  };
}

const OFFER_POPULATE = { image: true, imageLocalized: true, products: true };

/**
 * Published offers whose window includes `now`, in editor order (`compareOffers`). The Ukrainian
 * entries decide which offers are active (dates aren't localized); in another locale, each one is
 * swapped for its published translation when it has one.
 */
export async function listActiveOffers(
  locale: Locale = DEFAULT_LOCALE,
  now: Date = new Date(),
): Promise<Offer[]> {
  const { data } = await cmsFetch(
    "offers",
    {
      filters: activeWindowFilter(now.toISOString()),
      sort: ["sortOrder:asc", "startsAt:desc"],
      pagination: { page: 1, pageSize: MAX_PAGE_SIZE },
      populate: OFFER_POPULATE,
    },
    collectionResponse(offerEntry),
    { locale: DEFAULT_LOCALE },
  );

  let entries = data;
  if (locale !== DEFAULT_LOCALE && data.length > 0) {
    const translations = await cmsFetch(
      "offers",
      {
        filters: { documentId: { $in: data.map((entry) => entry.documentId) } },
        pagination: { page: 1, pageSize: data.length },
        populate: OFFER_POPULATE,
      },
      collectionResponse(offerEntry),
      { locale },
    );
    const byDocumentId = new Map(translations.data.map((entry) => [entry.documentId, entry]));
    entries = data.map((entry) => byDocumentId.get(entry.documentId) ?? entry);
  }

  const baseUrl = getEnv().STRAPI_URL;
  return entries
    .map((entry) => toOffer(entry, baseUrl))
    .filter((offer) => isOfferActive(offer, now))
    .sort(compareOffers);
}
