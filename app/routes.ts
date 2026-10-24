import { index, layout, type RouteConfig, route } from "@react-router/dev/routes";

export default [
  layout("routes/_shop.tsx", [
    index("routes/home.tsx"),
    route("catalog/:gender", "routes/catalog.tsx"),
    route("products/:id", "routes/product.tsx"),
    route("blog", "routes/blog.tsx"),
    route("blog/:slug", "routes/blog-post.tsx"),
    route("login", "routes/login.tsx"),
    route("register", "routes/register.tsx"),
    route("cart", "routes/cart.tsx"),
    route("checkout", "routes/checkout.tsx"),
    route("account", "routes/account.tsx"),
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
  // Outside the shop layout: the admin area has its own. Every admin loader and action calls
  // `requireAdmin`; product (#16) and order (#17) management replace the placeholders.
  route("admin", "routes/admin.tsx", [
    index("routes/admin._index.tsx"),
    route("products", "routes/admin.products.tsx"),
    route("orders", "routes/admin.orders.tsx"),
  ]),
] satisfies RouteConfig;
