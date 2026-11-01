import {
  index,
  layout,
  type RouteConfig,
  type RouteConfigEntry,
  route,
} from "@react-router/dev/routes";
import type { Locale } from "./lib/i18n/locales";
import { LOCALES } from "./lib/i18n/locales";
import { EN_PREFIX, PAGES, type Page, pageRouteId } from "./lib/paths";

// Every page is registered once per language (#84): unprefixed Ukrainian paths and `/en/…` English
// ones, both from the path table in `app/lib/paths.ts`, sharing one route module. Route ids must
// be unique, so each gets `<page>.<locale>` (`pageRouteId`).

/** A page's pattern in `locale`, relative to its parent (`parent` is the parent page). */
function pathOf(page: Page, locale: Locale, parent?: Page): string {
  const pattern: string = PAGES[page][locale];
  if (parent) {
    return pattern.slice(PAGES[parent][locale].length + 1);
  }
  const prefix = locale === "en" ? EN_PREFIX.slice(1) : "";
  return [prefix, pattern].filter(Boolean).join("/");
}

/** One route per locale for `page`, with `children(locale)` nested in each. */
function localizedRoute(
  page: Page,
  file: string,
  children?: (locale: Locale) => RouteConfigEntry[],
): RouteConfigEntry[] {
  return LOCALES.map((locale) => {
    const path = pathOf(page, locale);
    const id = pageRouteId(page, locale);
    return path === "" ? index(file, { id }) : route(path, file, { id }, children?.(locale));
  });
}

/** A child page of `parent` in `locale`. */
function localizedChild(page: Page, parent: Page, file: string, locale: Locale): RouteConfigEntry {
  return route(pathOf(page, locale, parent), file, { id: pageRouteId(page, locale) });
}

export default [
  layout("routes/_shop.tsx", [
    ...localizedRoute("home", "routes/home.tsx"),
    ...localizedRoute("catalog", "routes/catalog.tsx"),
    ...localizedRoute("product", "routes/product.tsx"),
    ...localizedRoute("blog", "routes/blog.tsx"),
    ...localizedRoute("blogPost", "routes/blog-post.tsx"),
    ...localizedRoute("offers", "routes/offers.tsx"),
    ...localizedRoute("popular", "routes/popular.tsx"),
    ...localizedRoute("login", "routes/login.tsx"),
    ...localizedRoute("register", "routes/register.tsx"),
    ...localizedRoute("cart", "routes/cart.tsx"),
    ...localizedRoute("checkout", "routes/checkout.tsx"),
    ...localizedRoute("checkoutSuccess", "routes/checkout-success.tsx"),
    // Action-only (POST): a new card payment attempt from the success page (#44). Inside the
    // layout, so the visitor middleware still runs.
    ...localizedRoute("checkoutPay", "routes/checkout-pay.ts"),
    // Every account loader calls `requireUser`: child loaders run in parallel with the layout's.
    ...localizedRoute("account", "routes/account.tsx", (locale) => [
      index("routes/account._index.tsx", { id: `account-index.${locale}` }),
      localizedChild("accountOrder", "account", "routes/account.orders.$id.tsx", locale),
      localizedChild("accountProfile", "account", "routes/account.profile.tsx", locale),
    ]),
    ...localizedRoute("privacy", "routes/privacy.tsx"),
  ]),
  // Action-only (POST); outside the layout so its loader doesn't run for it.
  route("logout", "routes/logout.ts"),
  // Action-only (POST) language switcher; outside the layout for the same reason.
  route("locale", "routes/locale.ts"),
  // Action-only (POST) answer to the cookie banner (#18); outside the layout for the same reason.
  route("consent", "routes/consent.ts"),
  // Action-only (POST) endpoint for the client tracker's beacons (#18).
  route("api/events", "routes/api.events.ts"),
  // Action-only (POST) callback from the card payment provider (#44); no layout, session or consent.
  route("payments/callback", "routes/payments.callback.ts"),
  // Dev only: the local payment simulator's hosted page (#44), a 404 unless
  // `PAYMENT_PROVIDER=simulator`. Outside the shop layout, like a provider's own page.
  route("payments/simulator", "routes/payments.simulator.tsx"),
  // Action-only (POST) sync endpoints for Strapi's document middleware (#40): staff edit products
  // and orders in the Strapi admin, and the app applies each edit before Strapi saves it.
  // Authenticated by `CMS_SYNC_SECRET`; no layout, session or consent.
  route("cms/products", "routes/cms.products.ts"),
  route("cms/orders/:id", "routes/cms.orders.$id.ts"),
  // Every other URL: the 301s from old paths (`/catalog/women`, `/uk/…`, `/en/koshyk`), else a 404
  // (#84). Outside the layout, like unmatched URLs before.
  route("*", "routes/redirects.ts"),
] satisfies RouteConfig;
