// App-level types and pure helpers for the analytics tables (`sessions` and `user_events` in
// app/.server/db/schema.ts). No server imports, so both server and client code can import them.
//
// These are visitor sessions for traffic and conversion analysis, not the auth cookie session
// (app/.server/session.ts).
import type { ShouldRevalidateFunctionArgs } from "react-router";
import { resolveAcquisitionChannel } from "./auth";
import type { CatalogGender, CatalogSort } from "./catalog";
import type { EventType, PaymentMethod } from "./enums";
import { crossesLocale } from "./paths";
import { defaultVariant } from "./products";

// The event contract (#129): what `user_events.event_properties` holds for each event type, with
// snake_case keys. `analytics.schema.ts` validates it and `docs/analytics-events.md` documents it.
// Never put personal data (names, emails, phones, addresses) into properties.

/** The product lists a product can be shown in, for `list_id` (#129). */
export const LIST_IDS = [
  "catalog",
  "popular",
  "offers",
  "similar",
  "search",
  "trio",
  "home",
] as const;

export type ListId = (typeof LIST_IDS)[number];

/** How long a card must stay at least half visible to count as a `product_impression`. */
export const MIN_IMPRESSION_VISIBLE_MS = 1000;

/** `product_dwell.dwell_ms` is capped at 30 minutes. */
export const MAX_DWELL_MS = 30 * 60_000;

/** Most result ids a `search` event lists. */
export const MAX_SEARCH_RESULT_IDS = 24;

/** Where a product was shown: its list, its 1-based position there and the search it came from. */
export interface ListContext {
  list_id: ListId;
  /** 1-based and absolute across pages (`absoluteListPosition`). */
  list_position: number;
  /** Links the list's impressions and clicks to its `search` event. */
  search_id?: string;
}

/** Shared by every product event: the product, the size and its price and stock when shown. */
export interface ProductEventContext extends Partial<ListContext> {
  product_public_id: string;
  /** The size's `public_id`; `null` for a product without sizes. */
  variant_id: string | null;
  volume_ml: number | null;
  /** An exact decimal string (`"499.00"`); `null` for a product without sizes. */
  price: string | null;
  in_stock: boolean;
}

/** A product event that happened in a list, so the list context is required. */
export type ListedProductEvent = ProductEventContext & ListContext;

export interface CartChangeProperties extends ProductEventContext {
  /** Units added or removed. */
  quantity: number;
  /** The cart subtotal after the change, before discounts. */
  cart_value_after: string;
  /** `stepper`: the cart page's +/− buttons. */
  source?: "stepper";
}

export interface PurchaseItem {
  variant_id: string;
  quantity: number;
  unit_price: string;
  /** This line's share of the order discount (`order_items.discount_allocated`). */
  discount_allocated: string;
}

/** The properties of each event type. */
export interface EventPropertiesMap {
  page_view: { path: string };
  product_view: ProductEventContext;
  product_impression: ListedProductEvent;
  product_click: ListedProductEvent;
  product_dwell: ProductEventContext & {
    /** Visible time on the product page, at most `MAX_DWELL_MS`. */
    dwell_ms: number;
    /** How far down the page was read, 0–100. */
    max_scroll_pct: number;
  };
  search: {
    search_id: string;
    /** Reserved for a text search; the catalog only has filters, so always `null` today. */
    query: string | null;
    gender: CatalogGender;
    fragrance_family: string | null;
    brand: string | null;
    sort: CatalogSort;
    page: number;
    result_count: number;
    /** The results shown, in order, at most `MAX_SEARCH_RESULT_IDS`. */
    product_public_ids: string[];
  };
  add_to_cart: CartChangeProperties;
  remove_from_cart: CartChangeProperties;
  checkout_start: {
    subtotal: string;
    item_count: number;
    discount_amount: string;
    discount_code: string | null;
  };
  purchase: {
    order_id: number;
    subtotal: string;
    total_amount: string;
    discount_amount: string;
    discount_id: number | null;
    discount_code: string | null;
    gift_card_amount: string;
    payment_method: PaymentMethod;
    items: PurchaseItem[];
    /** No earlier order by the same user, or for a guest the same email. */
    is_first_order: boolean;
  };
  login: { method: "login" | "register" | "password_reset" };
  review_submit: { product_public_id: string };
}

/** The `event_properties` of an event type; without one, of any event. */
export type EventProperties<T extends EventType = EventType> = EventPropertiesMap[T];

/** A size as product cards and pages have it. */
interface ShownVariant {
  id: string;
  volumeMl: number;
  price: string;
  inStock: boolean;
}

/**
 * The shared product event properties for a product as shown: the size `variantId`, else its
 * preselected size (`defaultVariant`). A product without sizes has no size, price or stock.
 */
export function productEventContext(
  product: { id: string; variants: readonly ShownVariant[] },
  variantId?: string,
  list?: ListContext,
): ProductEventContext {
  const variant =
    product.variants.find((candidate) => candidate.id === variantId) ??
    defaultVariant(product.variants);
  return {
    product_public_id: product.id,
    variant_id: variant?.id ?? null,
    volume_ml: variant?.volumeMl ?? null,
    price: variant?.price ?? null,
    in_stock: variant?.inStock ?? false,
    ...list,
  };
}

/** The 1-based position of the `index`th card of `page` across all pages. */
export function absoluteListPosition(page: number, pageSize: number, index: number): number {
  return (Math.max(page, 1) - 1) * pageSize + index + 1;
}

export interface AnalyticsSession {
  sessionId: string;
  /** `null` until the visitor logs in or registers. */
  userId: number | null;
  /** Visitor id from the `anonymous_id` cookie, set before signup. */
  anonymousId: string;
  startedAt: Date;
  /** Time of the last request in the session. */
  endedAt: Date | null;
  landingPage: string | null;
  trafficSource: string | null;
  trafficMedium: string | null;
  trafficCampaign: string | null;
  deviceType: string | null;
}

export interface UserEvent {
  eventId: string;
  /** `null` until the visitor logs in or registers. */
  userId: number | null;
  anonymousId: string;
  sessionId: string;
  eventType: EventType;
  /** `null` for events that aren't about a product, or once the product has been deleted. */
  productId: number | null;
  eventProperties: EventProperties | null;
  /** UTM source, medium and campaign. */
  source: string | null;
  medium: string | null;
  campaign: string | null;
  deviceType: string | null;
  referrer: string | null;
  createdAt: Date;
}

/** An analytics session ends after this many minutes without a request (#18). */
export const SESSION_TIMEOUT_MINUTES = 30;

export const DEVICE_TYPES = ["mobile", "tablet", "desktop"] as const;

export type DeviceType = (typeof DEVICE_TYPES)[number];

// Tablets first: Android tablets don't say "Mobile", Android phones do.
const TABLET_UA = /iPad|Tablet|PlayBook|Silk|Android(?!.*Mobile)/i;
const MOBILE_UA = /Mobi|iPhone|iPod|Android|BlackBerry|Opera Mini|IEMobile/i;

/** The device type from a `User-Agent` header; `null` when there is none. */
export function resolveDeviceType(userAgent: string | null): DeviceType | null {
  if (!userAgent) {
    return null;
  }
  if (TABLET_UA.test(userAgent)) {
    return "tablet";
  }
  return MOBILE_UA.test(userAgent) ? "mobile" : "desktop";
}

/** Where a visit came from, stored on `sessions` and copied onto each of its events. */
export interface TrafficAttribution {
  /** `utm_source`, else the external referrer's host, else `"direct"`. */
  source: string;
  /** `utm_medium`; without UTM tags `"referral"` (external referrer) or `"none"`. */
  medium: string | null;
  /** `utm_campaign`, if any. */
  campaign: string | null;
}

function utmParam(url: URL, name: string): string | null {
  return url.searchParams.get(name)?.trim().toLowerCase().slice(0, 100) || null;
}

/**
 * The traffic attribution of a visit that starts with this request. `source` follows the rules of
 * `users.acquisition_channel` (`resolveAcquisitionChannel`).
 */
export function resolveTrafficAttribution(url: URL, referer: string | null): TrafficAttribution {
  const source = resolveAcquisitionChannel(url, referer);
  const campaign = utmParam(url, "utm_campaign");
  if (utmParam(url, "utm_source")) {
    return { source, medium: utmParam(url, "utm_medium"), campaign };
  }
  return { source, medium: source === "direct" ? "none" : "referral", campaign };
}

/** Event types the browser may send to `/api/events`; the rest are only recorded by the server. */
export const CLIENT_EVENT_TYPES = [
  "page_view",
  "product_impression",
  "product_click",
  "product_dwell",
] as const satisfies readonly EventType[];

export type ClientEventType = (typeof CLIENT_EVENT_TYPES)[number];

/** Client events about a product; each carries `properties` and fills `product_id`. */
export const CLIENT_PRODUCT_EVENT_TYPES = [
  "product_impression",
  "product_click",
  "product_dwell",
] as const satisfies readonly ClientEventType[];

export type ClientProductEventType = (typeof CLIENT_PRODUCT_EVENT_TYPES)[number];

/** Most events one `/api/events` request may carry. */
export const MAX_CLIENT_EVENTS = 20;

export type { ClientEvent, ClientEventBatch } from "./analytics.schema";

/**
 * `shouldRevalidate` for routes whose loader records a view (`product_view`, `search`): a form
 * post (cart, language switch, cookie banner) doesn't change their data, and reloading them would
 * record the same view twice. Navigations still load as usual, and switching the language always
 * reloads (#112).
 */
export function shouldRevalidateView({
  formMethod,
  currentUrl,
  nextUrl,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs): boolean {
  if (crossesLocale({ currentUrl, nextUrl })) {
    return true;
  }
  if (formMethod && formMethod.toUpperCase() !== "GET") {
    return false;
  }
  return defaultShouldRevalidate;
}
