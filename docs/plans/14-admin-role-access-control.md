# Plan: Add admin role, access control and admin layout route (#14)

Issue: https://github.com/savchukolgaa/jassmin/issues/14
Branch: `issue/14`
Worktree: `.claude/worktrees/issue-14`
Status: Planned

## Goal
As a store admin, I want a secure admin area so that only authorised staff can manage products
and orders. Add a `role` to `users`, a `requireAdmin` helper, and an `/admin` layout route (sidebar
with Products, Orders and an external "Content (Strapi)" link) that the product (#16) and order
(#17) management routes nest under, plus a documented way to create the first admin.

## Dependencies & prerequisites
- **#9 (auth, closed):** done. `getUser` / `requireUser` live in `app/.server/services/auth.ts`,
  the cookie session in `app/.server/session.ts`, `loginRedirectPath` / `safeRedirect` in
  `app/lib/auth.ts`.
- **#20 (Strapi, closed):** done. `STRAPI_URL` is in `app/.server/env.ts` (default
  `http://localhost:1337`, falls back to Aspire's `CMS_HTTP`).
- **#16, #17 (open):** consumers of this issue. They replace the placeholder child routes added
  here.
- **No new packages and no new env vars.**
- **Migration:** one new Drizzle migration (`user_role`) plus its hand-written rollback.

### ⚠️ Parallel migrations (#5, #26, #14)
#5 (analytics schema), #26 (product variants) and this issue each add a Drizzle migration on top of
`0001_commerce_schema`, and they are being worked on in parallel. Drizzle numbers migrations
sequentially and records them in `meta/_journal.json` plus a `meta/<idx>_snapshot.json` chained
to the previous snapshot, so two branches that both generate `0002_*` will conflict.

**If #5 or #26 lands on `main` before this PR merges:** rebase `issue/14` on `origin/main`, then
**regenerate** the migration instead of hand-merging the journal/snapshots:
1. Delete this branch's `app/.server/db/migrations/0002_user_role.sql`, its
   `meta/0002_snapshot.json` and its `_journal.json` entry (take `main`'s journal as-is).
2. Rename `app/.server/db/rollbacks/0002_user_role.sql` to the new tag (e.g. `0003_user_role.sql`).
3. Run `pnpm db:generate --name user_role` so drizzle-kit diffs against `main`'s latest snapshot.
4. Check the generated SQL only adds the enum and the `role` column, then re-run the migrator
   test and `pnpm db:rollback` locally.
The same applies the other way round to #5 and #26 if this one lands first.

## Decisions & assumptions
- **Role as a PostgreSQL enum.** Add `USER_ROLES = ["customer", "admin"] as const` and
  `UserRole` to `app/lib/enums.ts`, and `userRoleType = pgEnum("user_role", USER_ROLES)` in
  `schema.ts`, following the existing pattern (`gender_type`, `order_status_type`, …) rather than
  text + CHECK. `users.role` is `userRoleType().notNull().default("customer")`. Existing rows get
  `'customer'` from the default; registration needs no change. This confirms the issue's
  assumption.
- **`requireAdmin` goes in `app/.server/services/auth.ts`**, next to `requireUser`, not in
  `session.ts` as the issue says. `session.ts` only handles the cookie; user lookups (DB) are in
  `services/auth.ts` (see `app/.server/AGENTS.md`, "Auth"). Signature:
  `requireAdmin(request, database = db): Promise<PublicUser>`. Logged out → `requireUser` throws the
  redirect to `/login?redirectTo=<path>`; logged in but not admin → `throw data("Forbidden", { status: 403 })`.
- **Role is read from the DB on every request**, not stored in the session cookie. Demoting an
  admin takes effect immediately, and a stale cookie can't grant access.
- **`PublicUser` gets `role: UserRole`**; `findUserById` selects it. Still never the password hash.
- **Route structure:** replace the `route("admin/*", "routes/admin.tsx")` placeholder with a real
  layout route outside the shop layout:
  ```ts
  route("admin", "routes/admin.tsx", [
    index("routes/admin._index.tsx"),
    route("products", "routes/admin.products.tsx"),
    route("orders", "routes/admin.orders.tsx"),
  ]),
  ```
  `admin._index` redirects to `/admin/products` (after `requireAdmin`). `admin.products.tsx` and
  `admin.orders.tsx` are minimal placeholders (loader calls `requireAdmin`, renders "Coming in
  #16/#17") so the sidebar links don't 404; #16/#17 replace or split them
  (`admin.products._index`, `admin.products.new`, …). Unknown `/admin/*` paths fall through to the
  root 404, after no admin loader ran (no data leaks).
- **Every admin loader and action calls `requireAdmin`.** The layout loader alone doesn't protect
  child actions (and child loaders run in parallel with it). Document this rule in
  `app/.server/AGENTS.md` so #16/#17 follow it.
- **403 page:** add a `403` case to `describeRouteError` ("You don't have access to this page.")
  and an `ErrorBoundary` in `admin.tsx` that renders `ErrorContent` without the sidebar, so a
  forbidden user never sees the admin navigation.
- **Strapi link:** `${STRAPI_URL}/admin`, built in the admin layout loader (server-only env) with
  `new URL("/admin", env.STRAPI_URL)`, opened with `target="_blank" rel="noopener noreferrer"`.
  **(unconfirmed, see Q1)**
- **Promotion script:** `pnpm db:make-admin <email>` → `app/.server/db/scripts/make-admin.ts`,
  same shape as `scripts/seed.ts` (loads `.env`, `getDatabaseUrl`, `createDb(url, 1)`, closes the
  pool). It normalises the email like `~/lib/auth`, sets `role = 'admin'`, and exits 1 with a clear
  message if no user has that email (the user must register first through `/register`). A
  `--revoke` flag sets the role back to `customer`. The DB logic is a small query
  `setUserRole(db, email, role)` in `db/queries/users.ts` so it's testable.
- **Admin UI:** own minimal layout (no shop header/footer): left sidebar on `md+`, top nav on
  mobile, using the Option C+ tokens, typeface and `focusRing` from `docs/design.md` /
  `app/components/layout/nav.ts`. Active link via `NavLink` with `aria-current`. Shows the admin's
  name and a "Log out" form posting to `/logout`, and a "Back to shop" link. The admin area isn't on
  the C+ canvas, so this is a functional, on-brand layout rather than a pixel spec.
- **Meta:** admin pages set `{ name: "robots", content: "noindex" }`.

## Open questions
- [ ] **Q1: Which URL should the "Content (Strapi)" link use?** — Why it matters: `STRAPI_URL` is
  the URL the *server* uses to reach Strapi; in production it could be an internal hostname that
  the admin's browser can't open. Recommended default: `${STRAPI_URL}/admin` now (correct for local
  dev and Aspire, where it's `localhost:1337`); add an optional `STRAPI_ADMIN_URL` env var later
  when Strapi is deployed (hosting is out of scope per #20). Affects steps: 6.
- [ ] **Q2: Should the shop header show an "Admin" link for admins?** — Why it matters: otherwise
  admins type `/admin` by hand. Recommended default: out of scope here (keeps the header untouched
  while other UI issues run in parallel); a follow-up can add it using `role` from `getUser`.
  Affects steps: none.

## Resolved questions
- **Enum or text with CHECK for `role`?** — Enum, built from a value array in `~/lib/enums`, like
  every other enum column (source: `app/.server/AGENTS.md` "Database", `app/.server/db/schema.ts`).
- **Where does `requireAdmin` live?** — `app/.server/services/auth.ts`, beside `requireUser`, since
  it needs a DB lookup (source: `app/.server/services/auth.ts`, `app/.server/AGENTS.md` "Auth").
- **Where do logged-out users go?** — `/login?redirectTo=<admin path>` via `requireUser` /
  `loginRedirectPath`; after login `safeRedirect` sends them back to `/admin/...` (source:
  `app/lib/auth.ts`, #9).
- **Is blog/site content managed in `/admin`?** — No, only products and orders; content is edited in
  the Strapi admin, which has its own accounts (source: #14 context, #20).
- **Does the admin area already have a route slot?** — Yes, `route("admin/*", "routes/admin.tsx")`
  placeholder outside the shop layout, with a test in `app/routes.test.ts` (source: `app/routes.ts`).
- **Every migration needs a rollback?** — Yes, `db/rollbacks/<tag>.sql` (source:
  `app/.server/AGENTS.md` "Database").

## Files
| Action | Path | Purpose |
|--------|------|---------|
| modify | `app/lib/enums.ts` | `USER_ROLES`, `UserRole` |
| modify | `app/lib/enums.test.ts` | test the new values |
| modify | `app/.server/db/schema.ts` | `userRoleType` enum, `users.role` column |
| modify | `app/.server/db/schema.test.ts` | users columns + default, enum matches `USER_ROLES` |
| create | `app/.server/db/migrations/0002_user_role.sql` (+ `meta/0002_snapshot.json`, `_journal.json`) | generated by `pnpm db:generate --name user_role` |
| create | `app/.server/db/rollbacks/0002_user_role.sql` | drop column, drop type |
| modify | `app/.server/db/migrator.test.ts` | `role` exists with default `customer`; rollback removes it |
| modify | `app/.server/db/queries/users.ts` | `role` in `PublicUser` / `findUserById`; `setUserRole` |
| modify | `app/.server/db/queries/users.test.ts` | role default, `setUserRole` |
| create | `app/.server/db/scripts/make-admin.ts` | promote/revoke CLI |
| modify | `package.json` | `db:make-admin` script |
| modify | `app/.server/services/auth.ts` | `requireAdmin` |
| modify | `app/.server/services/auth.test.ts` | `requireAdmin` cases |
| modify | `app/lib/route-error.ts` (+ test) | 403 message |
| modify | `app/routes.ts`, `app/routes.test.ts` | admin layout + children |
| modify | `app/routes/admin.tsx` | layout: loader, sidebar, `Outlet`, `ErrorBoundary` |
| create | `app/routes/admin._index.tsx` | redirect to `/admin/products` |
| create | `app/routes/admin.products.tsx`, `app/routes/admin.orders.tsx` | guarded placeholders for #16/#17 |
| create | `app/features/admin/AdminNav.tsx` | sidebar / mobile nav |
| create | `app/features/admin/admin-nav.ts` (+ `admin-nav.test.ts`) | nav items, Strapi admin URL helper |
| create | `app/routes/admin.test.ts` | loader access tests for layout and children |
| modify | `app/.server/AGENTS.md` | role + "every admin loader/action calls `requireAdmin`" |
| modify | `README.md` | "Admin area" section: creating the first admin |

## Steps
- [ ] **1. Role enum and column** — Add `USER_ROLES` / `UserRole` to `app/lib/enums.ts`. In
  `schema.ts` add `userRoleType = pgEnum("user_role", USER_ROLES)` and
  `role: userRoleType().notNull().default("customer")` on `users` (after `acquisitionChannel`; keep
  every existing column untouched). Update the header comment's issue list. Extend
  `enums.test.ts` and `schema.test.ts` (columns, default, enum values). Check: `pnpm typecheck`,
  `pnpm test`.
- [ ] **2. Migration and rollback** — `pnpm db:generate --name user_role`; confirm the SQL is only
  `CREATE TYPE "public"."user_role" AS ENUM('customer', 'admin');` and
  `ALTER TABLE "users" ADD COLUMN "role" "user_role" DEFAULT 'customer' NOT NULL;`. Write
  `db/rollbacks/0002_user_role.sql` (`ALTER TABLE "users" DROP COLUMN "role";` then
  `DROP TYPE "public"."user_role";`, with `--> statement-breakpoint`). Extend `migrator.test.ts`.
  Check: `pnpm db:migrate`, `pnpm db:rollback`, `pnpm db:migrate` against the dev DB. **If #5 or
  #26 merged first, follow "Parallel migrations" above.**
- [ ] **3. User queries** — Add `role` to `PublicUser` and the `findUserById` select. Add
  `setUserRole(db, email, role): Promise<boolean>` (`update … returning id`, `true` when a row
  changed). Tests in `users.test.ts` (DB-backed, `createTestDatabase`).
- [ ] **4. `requireAdmin`** — In `services/auth.ts`: `await requireUser(request, database)`; if
  `user.role !== "admin"` throw `data("Forbidden", { status: 403 })`; return the user. Unit tests
  with the DB mocked / a test DB: logged out → 302 to `/login?redirectTo=/admin/orders?x=1`;
  customer → 403; admin → user; deleted user with a cookie → redirect.
- [ ] **5. 403 error text** — Add the 403 branch to `describeRouteError` and a test.
- [ ] **6. Admin layout route** — Update `routes.ts` as in Decisions and `routes.test.ts` (admin is a
  layout with `""`/`products`/`orders` children, still outside the shop layout). Rewrite
  `routes/admin.tsx`: `loader` → `requireAdmin`, returns `{ admin: { fullName }, strapiAdminUrl }`;
  `meta` with title + `noindex`; component renders `AdminNav` + `<Outlet />`; `ErrorBoundary` renders
  `ErrorContent` with `describeRouteError` and a "Back to shop" link. `admin-nav.ts` holds
  `ADMIN_NAV_ITEMS` (`/admin/products`, `/admin/orders`) and `strapiAdminUrl(base)`; `AdminNav.tsx`
  renders them with `NavLink`, the external Strapi link (`target="_blank"`,
  `rel="noopener noreferrer"`, visually marked as external), the admin's name and a Log out form.
  C+ tokens and `focusRing`.
- [ ] **7. Child routes** — `admin._index.tsx` (loader: `requireAdmin`, then
  `redirect("/admin/products")`), `admin.products.tsx` and `admin.orders.tsx` (loader:
  `requireAdmin`; placeholder body pointing to #16 / #17). No actions yet; leave a comment that
  every future action must start with `await requireAdmin(request)`.
- [ ] **8. Route access tests** — `app/routes/admin.test.ts`, mocking `~/.server/services/auth`
  like `logout.test.ts` mocks the session: for the layout and every child loader, assert
  `requireAdmin` is called with the request and its thrown 302/403 propagates; for an admin, the
  layout loader returns the name and `http://localhost:1337/admin`.
- [ ] **9. Promotion script** — `db/scripts/make-admin.ts` + `"db:make-admin": "tsx app/.server/db/scripts/make-admin.ts"`.
  Usage: `pnpm db:make-admin you@example.com` (`--revoke` to demote). Parse/normalise the email with
  the same zod `email` rule as `~/lib/auth` (export it if needed); print usage and exit 1 on bad
  input or unknown user.
- [ ] **10. Docs** — README "Admin area": register at `/register`, run `pnpm db:make-admin <email>`
  (under Aspire, with `JASSMINDB_URI`/`DATABASE_URL` pointing at the app DB), log in, open `/admin`;
  note Strapi admins are separate. Add the command to the scripts table. Update
  `app/.server/AGENTS.md` (Auth: `requireAdmin`, role read from DB per request, every admin
  loader *and* action calls it; Database: `users.role`).
- [ ] **11. Verify** — `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`; manual checks below.

## Testing & verification
- Unit: `enums.test.ts`, `schema.test.ts`, `route-error.test.ts`, `admin-nav.test.ts`,
  `routes.test.ts`, `routes/admin.test.ts`, `services/auth.test.ts`.
- DB integration (skipped without a DB): `migrator.test.ts` (column, default, rollback),
  `users.test.ts` (`setUserRole`, `findUserById` role).
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Manual (`pnpm aspire run`): logged out `/admin/orders` → login → back on `/admin/orders`; a
  customer gets the 403 page with no sidebar; after `pnpm db:make-admin`, the admin sees the layout,
  Products/Orders nav with active state, and the Strapi link opens `http://localhost:1337/admin` in a
  new tab; `--revoke` → next request is 403; keyboard focus rings visible; mobile width usable.

## Acceptance criteria
- [ ] Non-admins get 403 on all `/admin/*` loaders and actions — steps 4, 6, 7, 8 (actions arrive
  in #16/#17; the rule is documented in step 10)
- [ ] Logged-out users are redirected to login — steps 4, 8
- [ ] Admins see the admin layout with Products and Orders navigation and a link to the Strapi
  admin — steps 6, 7
- [ ] There is a documented way to create the first admin — steps 9, 10

## Out of scope
- Product management (#16) and order management (#17) screens and their actions.
- Blog/site content management (Strapi, #20).
- An admin UI for managing roles, more roles than `customer`/`admin`, audit logging.
- An "Admin" link in the shop header (Q2), a separate `STRAPI_ADMIN_URL` (Q1).
