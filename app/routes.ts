import { index, layout, type RouteConfig, route } from "@react-router/dev/routes";

export default [
  layout("routes/_shop.tsx", [
    index("routes/home.tsx"),
    route("catalog/:gender", "routes/catalog.tsx"),
    // `:handle` is the slug, or an old UUID / former slug that answers 301 to it (#83).
    route("products/:handle", "routes/product.tsx"),
    route("blog", "routes/blog.tsx"),
    route("blog/:slug", "routes/blog-post.tsx"),
    route("offers", "routes/offers.tsx"),
    route("popular", "routes/popular.tsx"),
    route("login", "routes/login.tsx"),
    route("register", "routes/register.tsx"),
    route("cart", "routes/cart.tsx"),
    route("checkout", "routes/checkout.tsx"),
    route("checkout/success/:orderId", "routes/checkout-success.tsx"),
    // Action-only (POST): a new card payment attempt from the success page (#44). Inside the
    // layout, so the visitor middleware still runs.
    route("checkout/pay/:orderId", "routes/checkout-pay.ts"),
    // Every account loader calls `requireUser`: child loaders run in parallel with the layout's.
    route("account", "routes/account.tsx", [
      index("routes/account._index.tsx"),
      route("orders/:id", "routes/account.orders.$id.tsx"),
      route("profile", "routes/account.profile.tsx"),
    ]),
    route("privacy", "routes/privacy.tsx"),
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
] satisfies RouteConfig;
