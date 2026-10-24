# AGENTS.md: app/.server

Server-only code. Nothing in this folder may be imported by code that ends up in the browser bundle. Import it only from route `loader`/`action` functions or from other `.server` modules.

## Environment: `env.ts`

- Read configuration only through `getEnv()`, never through `process.env` directly. `getEnv()` loads `.env` (existing variables win), validates with zod and memoizes the result.
- To add a variable, extend `envSchema`, add it to `.env.example` and the README table, and add a case to `env.test.ts`.
- The database URL is `JASSMINDB_URI` (injected by Aspire for the `jassmindb` resource) when it's set, otherwise `DATABASE_URL`. Aspire's value must win, because `.env` usually keeps a `DATABASE_URL` for runs without Aspire. Keep this precedence in `env.ts` and `drizzle.config.ts`.
- `SMTP_URL` (optional, `smtp://` / `smtps://`) is where contact emails go; under Aspire it's the `smtp4dev` container's SMTP endpoint. `CONTACT_INBOX` and `CONTACT_FROM` have defaults.
- `STRAPI_URL` defaults to `http://localhost:1337` and falls back to `CMS_HTTP` (Aspire's `cms` reference). `STRAPI_API_TOKEN` is optional on purpose, so the app boots before a Strapi admin has created the token.

## CMS: `cms/`

Editorial content (blog, home page copy, contact details) lives in Strapi (`cms/` at the repo root). Products, orders and users stay in PostgreSQL.

- Loaders read CMS content only through `cms/content.ts` (`getHomePage`, `getSiteSettings`, `listBlogPosts`, `getBlogPostBySlug`). These return the DTOs from `~/lib/cms`, never raw Strapi shapes, with media URLs already absolute.
- CMS content is localized (`uk` default, `en`; #43). Every content query takes a `Locale`: pass `await getLocale(request)` from the loader. When the requested locale has no entry, it falls back to Ukrainian through `withLocaleFallback` (a single type's 404 counts as missing; other errors never fall back), and each DTO's `locale` says which language was served. Components mark fallback text with `lang={useContentLang(dto.locale)}`. The blog list paginates over the Ukrainian posts and swaps in their translations by `documentId`.
- `cms/client.ts` (`cmsFetch`) always adds `status=published` (plus `locale` when given), sends the read-only token and times out after `CMS_TIMEOUT_MS`. Every response is validated with a schema from `cms/schemas.ts`. When you add a field in Strapi, add it to the schema, the DTO, the mapper and the fixtures.
- Failures throw `CmsError` (`cms/errors.ts`). In loaders, wrap CMS calls with `.catch(cmsUnavailable)`, which turns them into a 503 for the `ErrorBoundary`. A missing blog post is `null`, so throw a 404 for it in the route.
- Tests use the recorded Strapi responses in `cms/__fixtures__/`: `<name>.json` is the `uk` response and `<name>.en.json` the `en` one. Re-record both from a seeded Strapi (`pnpm cms:seed`) when the content model changes.

## Markdown, mail and rate limiting

- `markdown.ts`: `renderMarkdown()` turns CMS Markdown into sanitized HTML (render it with `RichText` from `~/components/ui/RichText`); `toPlainText()` is for meta descriptions. Never inject CMS HTML that didn't go through `renderMarkdown()`.
- `mail.ts`: `getMailTransport()` returns the shared nodemailer transport built from `SMTP_URL`, or `null` when it's not set. Send plain-text emails and keep user input out of headers (strip CR/LF).
- `rate-limit.ts`: in-memory fixed-window `createRateLimiter()` and `clientKey(request)`. State is per process; switch to a shared store before running several instances.
- `services/contact.ts`: the home page contact form (honeypot → rate limit → email to `CONTACT_INBOX`). Dependencies are injectable for tests.

## Database: `db/`

- `db/index.ts` exports the single Drizzle client `db` (with `casing: "snake_case"`) and the `Db` type. Don't create other pools in app code. `db/client.ts` (`createDb(url)`) is only for CLI scripts (`db/scripts/`) and integration tests, which connect without `getEnv()` and close their own pool.
- Define tables and enums in `db/schema.ts`, in TypeScript camelCase. The `snake_case` casing maps them to snake_case columns. drizzle-kit doesn't apply the casing to auto-generated constraint names, so give `.unique()` and similar constraints an explicit snake_case name (e.g. `products_public_id_unique`).
- Build enums from the value arrays in `~/lib/enums` (`pgEnum("gender_type", GENDERS)`), so the TS unions and the database can't drift apart.
- `products.price` is `numeric(10, 2)` and comes back as a string, so never use floats for money. `volume_ml` is the volume of one unit, and the total is `pack_size * volume_ml`. `public_id` (UUID v7 from `uuidv7()`, PostgreSQL 18+) is the stable external key, while `id` stays the FK target.
- Products are sold in volume variants (`product_variants`, #26): one row per size with its own `price` (`numeric(10, 2)`), `stock_quantity` and `volume_ml`. The CHECK limits `volume_ml` to `PERFUME_VOLUMES_ML` from `~/lib/enums`, `(product_id, volume_ml)` is unique, and `pack_size` stays on the product. A variant's `public_id` is what forms post as `variantId`. Products without variants aren't listed in the catalog.
- `products.price`, `products.volume_ml` and `products.stock_quantity` are **deprecated** (still NOT NULL, kept until after #16): app code reads price, volume and stock only from `product_variants`. New products still have to fill them, e.g. with their main size.
- Cart lines are per variant: `cart_items.variant_id` is required, and `(cart_id, variant_id)` is unique. Keep `cart_items.product_id` equal to the variant's product. Validate a submitted `variantId` with `checkVariantForCart` (`services/products.ts`) before you store it.
- At checkout (#11), check and decrement `product_variants.stock_quantity` inside the order transaction, copy the variant price into `order_items.price_at_purchase`, and set `order_items.variant_id` and the `order_items.volume_ml` snapshot.
- Commerce tables (`carts`, `cart_items`, `orders`, `order_items`): every order amount and `order_items.price_at_purchase` is also `numeric(10, 2)`, computed on the server. Their row types (and `product_variants`') are mirrored in `~/lib/commerce`, and `schema.test.ts` fails if the two drift apart. `orders.payment_method` is limited to `PAYMENT_METHODS` by a CHECK constraint. `carts.user_id` and `orders.user_id` use `on delete restrict`, so a user with carts or orders can't be deleted. `carts.session_id` references `sessions` with `on delete set null`.
- Analytics tables (`sessions`, `user_events`): these are visitor sessions for traffic and conversion analysis, not the auth cookie session in `session.ts`. Their row types are mirrored in `~/lib/analytics` (`AnalyticsSession`, `UserEvent`) and checked by `schema.test.ts`. `user_events.event_type` is limited to `EVENT_TYPES` by a CHECK constraint, so adding an event type means a migration that rewrites the check. `user_id` is filled in after login and set to `null` when the user is deleted (rows keep `anonymous_id`); deleting a session cascades to its events, and deleting a product nulls `user_events.product_id`. Sessions are created by `getVisitor` (below); #18 adds the events.
- `carts.updated_at` and `orders.updated_at` are refreshed by Drizzle's `$onUpdate` on every query-builder update. Raw SQL updates must set `updated_at = now()` themselves, and changes to `cart_items` must bump their cart's `updated_at` (the abandoned-cart job relies on it).
- One active cart per owner: the partial unique indexes `carts_active_user_id_unique` and `carts_active_guest_session_id_unique` (#10) allow a single `active` cart per user and per guest session, so `insertActiveCart` uses `onConflictDoNothing` and re-reads.
- `users.role` (`user_role` enum from `USER_ROLES`: `customer` | `admin`, default `customer`) controls access to `/admin` (#14). Change it only with `setUserRole` / `pnpm db:make-admin`.
- Migrations: `pnpm db:generate --name <name>` writes them to `db/migrations/`. Every migration needs a hand-written reverse in `db/rollbacks/<tag>.sql`, which `pnpm db:rollback` (`rollbackLatest` in `db/migrator.ts`) runs. Never edit an applied migration.
- `pnpm db:seed` (`db/seed.ts`) inserts `SAMPLE_PRODUCTS` from `db/seed-data.ts` with `onConflictDoNothing` on `public_id`, then their `variants` with `onConflictDoNothing` on `(product_id, volume_ml)`, so new sample sizes reach existing databases. Give new sample products a fresh fixed UUID v7, and never change an existing one.
- Put query functions in `db/queries/<area>.ts` and keep them small and typed. Put business rules that combine several queries in `services/`.
- Use `db.transaction(async (tx) => …)` whenever multiple writes must succeed together, and pass `tx` down instead of `db`.
- Raw `db.execute(sql\`…\`)` returns `timestamptz` values as **strings**, so convert them with `new Date()`. Typed queries built with the query builder return `Date`s.

## Visitor: `analytics.ts`

- `getVisitor(request)` returns the visitor's `anonymousId` and current analytics `sessionId`, creating them when missing (a `sessions` row plus the signed `anonymous_id` and `analytics_session` cookies), and the `headers` with their `Set-Cookie`. Send `headers` with the response. Only actions that write call it (today: adding to the cart).
- `readVisitor(request)` only parses the cookies and never writes. Loaders use it, so browsing doesn't create sessions rows.
- The cookie names live in `visitor-cookie.ts` (env-free). `hasSessionCookie` also counts `anonymous_id`, so blog pages with a guest's cart count aren't cached publicly.
- This is the minimal version from #10. #18 extends it (30-minute session windows, traffic source and device, `trackEvent`, `linkVisitorToUser`) without changing the signatures or the cookie names.

## Cart: `services/cart.ts`

- A user's active cart is found by `user_id`; a guest's by `anonymous_id`, through any of their `sessions` (so it survives a new session), with `user_id` null.
- Loaders read through `getCartOwner(request)` (a stale user cookie counts as a guest) and `getCartView` / `getCartCount`. Writes take a `CartWriter` with the ids from `getVisitor`. Only `addItem` may create the cart (`getOrCreateActiveCart`).
- Every change runs in a transaction that locks the cart row (`lockCart`) and ends with `touchCart`. A line's quantity may never exceed its variant's `stock_quantity`; stock isn't reserved, so checkout (#11) checks again.
- `mergeGuestCart` runs from `onUserAuthenticated`: without a user cart the guest cart is adopted; otherwise its lines are added to the user's (capped at stock, sold-out sizes dropped) and the guest cart is deleted.
- Line totals and the subtotal are computed in SQL as `numeric`, never in JS.

## Session: `session.ts`

- Cookie session storage (`__jassmin_session`, httpOnly, sameSite lax, secure in production). Use `getSession`, `commitSession` and `destroySession`, and type new fields in `SessionData`.
- `createUserSession({ request, userId, redirectTo })` logs a user in (sets `userId`, returns the redirect with `Set-Cookie`), and `logout(request)` destroys the session. `getUserId` only reads the cookie; use `getUser` when you need to know that the user exists.

## Auth: `services/auth.ts`, `password.ts`, `rate-limit.ts`

- Protected loaders and actions call `requireUser(request)`, which throws a redirect to `/login?redirectTo=<current path>` when logged out. Use `getUser(request)` (`null` when logged out) when the page works for both.
- **Every `/admin` loader and action calls `requireAdmin(request)`** (logged out → login redirect, not an admin → 403). The `routes/admin.tsx` layout loader doesn't protect child actions, and child loaders run in parallel with it, so don't rely on it. The role comes from the database on every call (`PublicUser.role`), never from the session cookie, so `pnpm db:make-admin <email> [--revoke]` takes effect on the next request.
- Never select or return `users.password_hash` outside `findUserByEmail` / `verifyLogin`. `PublicUser` is the shape the app gets.
- Passwords are hashed with argon2id in `password.ts` (`hashPassword`, `verifyPassword`). Emails are trimmed and lowercased by the zod schemas in `~/lib/auth` before every lookup or insert.
- Pass every redirect target that comes from the request (e.g. `redirectTo`) through `safeRedirect` from `~/lib/auth`.
- `verifyLogin` updates `last_login_at` (a churn-model feature) on every successful login; `registerUser` sets it too.
- Side effects after a login or registration go in `onUserAuthenticated`: it merges the guest cart (#10); linking analytics visitors and the `login` event come with #18. It must never make logging in fail, so it catches and logs its errors.
- Failed logins are rate-limited in memory (`loginLimiters`: 5 per email, 20 per IP per 15 minutes). The counters are per process and reset on restart.

## Tests

- Unit tests sit next to the code (`*.test.ts`).
- DB integration tests use `describe.skipIf(!hasDatabase)`, import modules dynamically inside the test (so the env is only validated when a DB exists) and close the pool in `afterAll` (`db.$client.end()`).
- Tests that migrate or write data use `createTestDatabase()` from `db/test-utils.ts` (a throwaway database, dropped in `afterAll`), never the development database.
