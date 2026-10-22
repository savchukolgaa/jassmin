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
  ]),
  // Outside the shop layout so the admin area (#14) can have its own.
  route("admin/*", "routes/admin.tsx"),
] satisfies RouteConfig;
