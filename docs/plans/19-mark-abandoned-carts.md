# Plan: Add scheduled job to mark inactive carts as abandoned (#19)

Issue: https://github.com/savchukolgaa/jassmin/issues/19
Branch: `issue/19`
Worktree: `.claude/worktrees/issue-19`
Status: Planned

## Goal
As a data analyst, I want inactive carts to be marked `abandoned` automatically, so that I can
measure the abandoned-cart rate and use it in churn models. A standalone CLI job, run hourly by an
external scheduler, flips `active` carts that have items and no activity for
`ABANDONED_CART_HOURS` (default 24) to `abandoned` and logs how many it changed.

## Dependencies & prerequisites
- **#10 (cart), closed and on `main`.** `carts.status`, `carts.updated_at` (`$onUpdate`), the
  `touchCart` call at the end of every cart change, and the index
  `carts_status_updated_at_idx (status, updated_at)` ("For the abandoned-cart job (#19)") already
  exist in `app/.server/db/schema.ts` / `db/queries/cart.ts`. **No migration is needed.**
- **#11 (checkout), still open.** It will set `converted`. This job only touches `active` carts, so
  it doesn't depend on #11. The "converted carts are not affected" test inserts a `converted` cart
  directly.
- New env var `ABANDONED_CART_HOURS` (optional, positive integer, default 24). No new packages:
  the CLI runs with `tsx`, like the other `db:*` scripts.

## Decisions & assumptions
- **Location follows the repo's CLI pattern instead of the issue's `scripts/` path.** All DB CLIs
  live in `app/.server/db/scripts/*.ts`, run through a `pnpm db:*` script with `tsx`, and keep their
  logic in a testable module next to them (`db/seed.ts` + `scripts/seed.ts`,
  `db/make-admin.ts` + `scripts/make-admin.ts`). The root `scripts/` only holds `aspire.mjs`, and
  Vitest only includes `app/**/*.test.ts`. So:
  - query: `markAbandonedCarts(db, hours)` in `app/.server/db/queries/cart.ts`
  - logic plus env parsing: `app/.server/db/abandoned-carts.ts`
  - CLI: `app/.server/db/scripts/mark-abandoned-carts.ts` and `pnpm db:mark-abandoned-carts`
- **The query uses the Drizzle query builder, not raw SQL.**
  `db.update(carts).set({ status: "abandoned", updatedAt: sql\`now()\` })` with
  `status = 'active'`, `updated_at < now() - make_interval(hours => $hours)` and
  `exists (select 1 from cart_items where cart_id = carts.id)`, then `.returning({ id })` and
  count the rows. Both timestamps come from the database clock (`now()`), never from JS
  `new Date()`, so app and DB clock skew can't move the threshold. It uses the existing
  `(status, updated_at)` index.
- **Idempotency comes from the `status = 'active'` filter.** A second run finds nothing to change
  and logs 0. A single `UPDATE` statement is atomic, so a crash halfway changes nothing.
- **Config is read without `getEnv()`.** Like `make-admin` / `seed`, the CLI loads `.env`, reads
  the DB URL with `getDatabaseUrl(process.env)` and validates `ABANDONED_CART_HOURS` with a small
  zod schema (`z.coerce.number().int().positive().default(24)`, with `""` treated as unset).
  `getEnv()` would also require `SESSION_SECRET`, which the job doesn't need. An invalid value
  prints an error and exits with code 1. An integer is needed because `make_interval(hours => …)`
  takes an `int`. The app doesn't read the variable, so it isn't added to `envSchema`.
- **A cart write racing with the job must not land in an abandoned cart.** The services resolve
  the cart id *before* the transaction and then `lockCart` it. If the job abandons the cart in
  between, `addItem` would add a line to a cart nobody sees any more. (In the opposite order
  PostgreSQL re-checks the `UPDATE`'s `WHERE` after the lock and sees the fresh `updated_at`, so
  that case is already safe.) To fix it, `lockCart` returns whether the locked cart is still
  `active` (it selects `status … for update`):
  - `addItem`: if the cart isn't active, it retries once with `getOrCreateActiveCart`, which now
    creates a new cart.
  - `updateQuantity` / `removeItem`: return `not-in-cart`, as for a missing cart.
  - `mergeGuestCart`: if the guest cart is no longer active there's nothing to merge. If the
    user's cart was abandoned, it adopts the guest cart.
- **A returning shopper gets a new, empty active cart (unconfirmed, Q1).** The cart lookups
  (`findActiveUserCartId`, `findActiveGuestCartId`) only see `active` carts, so after abandonment
  the cart disappears from the header and `/cart`, and the next `addItem` creates a new cart. That
  needs no cart-service change beyond the race fix, and `abandoned` stays a terminal status, so the
  rate stays clean. This is documented in `app/.server/AGENTS.md` (Cart section) and the README.
- **`updated_at` is set to `now()` on abandonment (unconfirmed, Q3)**, as in the issue's SQL and
  the rule that raw updates set it themselves.
- **Under Aspire**, the job gets an explicit-start resource `db-mark-abandoned-carts` (child of
  `jassmindb`, like `db-seed`), because only Aspire knows its database password. Hourly scheduling
  in production happens outside the app (Q2).

## Open questions
- [ ] **Q1: When a shopper with an abandoned cart returns, should they get a new empty cart, or get
  their items back?** Why it matters: with a new empty cart (the issue's first option), the items
  vanish from `/cart` after 24 h of inactivity, which may cost sales. Reactivating the abandoned
  cart brings the items back, but it turns an `abandoned` cart back into `active`/`converted`, so
  the abandon signal is lost unless it's logged elsewhere. A middle way is to create a new active
  cart and copy the latest abandoned cart's lines into it (the abandoned row stays for analytics).
  That is more code (capped at stock, like `mergeGuestCart`). Recommended default: **new empty
  cart**, with "restore items" as a follow-up issue. Affects steps: 3, 6.
- [ ] **Q2: What runs the job hourly in production, and does that environment have dev
  dependencies?** Why it matters: production runs `pnpm build && pnpm start` and the hosting isn't
  chosen yet. `pnpm db:*` scripts need `tsx`, which is a devDependency (the same applies to
  `db:seed` / `db:make-admin` today). Recommended default: document a system cron entry
  (`0 * * * * cd /srv/jassmin && pnpm db:mark-abandoned-carts`) and the `tsx` requirement in the
  README, and leave the hosting-specific cron to the deploy issue. Affects steps: 5, 6.
- [ ] **Q3: Should abandonment overwrite `updated_at`?** Why it matters: the issue's SQL sets
  `updated_at = now()`, so after the job `updated_at` is the time it was marked, not the last
  activity. That's off by up to the threshold plus one hour, and analysts may want the real
  last-activity time as a churn feature. Leaving `updated_at` untouched keeps it, at no cost.
  Recommended default: **follow the issue (set `now()`)**. If last activity matters, a later issue
  can add an `abandoned_at` column. Affects steps: 1.

## Resolved questions
- **Does the job need a new index or migration?** No. `carts_status_updated_at_idx` was added
  for #19 in #10 (source: `app/.server/db/schema.ts`, the `carts` table).
- **Is `updated_at` reliable as "last activity"?** Yes. Every add, update, remove and merge ends
  with `touchCart`, and the rule is documented (source: `app/.server/db/queries/cart.ts`
  `touchCart`, `app/.server/AGENTS.md` → Database).
- **Does a returning shopper hit a unique-index conflict?** No. The partial unique indexes only
  cover `status = 'active'`, so a new active cart can coexist with abandoned ones (source:
  `app/.server/db/migrations/0005_cart_active_unique.sql`).
- **Where do CLI DB scripts live, and how do they get the DB URL?** In
  `app/.server/db/scripts/`, with `createDb(url, 1)` and `getDatabaseUrl(process.env)`; they close
  the pool in `finally` (source: `app/.server/db/scripts/make-admin.ts`, `seed.ts`,
  `db/client.ts`).
- **Node cron / custom Express server?** Not applicable. The app uses `react-router-serve` with no
  custom server (source: `package.json` `start`), so the job runs as a separate process.
- **Optional admin metric?** Left out: it's optional in the issue, and #40 may replace the in-app
  admin with Strapi (source: #19, #40).

## Files
| Action | Path | Purpose |
|--------|------|---------|
| modify | `app/.server/db/queries/cart.ts` | `markAbandonedCarts(db, hours)`; `lockCart` returns whether the cart is still active |
| create | `app/.server/db/abandoned-carts.ts` | `parseAbandonedCartHours(env)`, `markAbandonedCartsJob(db, hours)` → count + message |
| create | `app/.server/db/abandoned-carts.test.ts` | Unit tests for env parsing; DB integration tests for the job |
| create | `app/.server/db/scripts/mark-abandoned-carts.ts` | CLI wrapper: loads `.env`, connects, runs, logs, closes the pool |
| modify | `app/.server/services/cart.ts` | Handle a cart abandoned between lookup and lock |
| modify | `app/.server/services/cart.test.ts` | Tests for the race handling and for "returning shopper gets a new cart" |
| modify | `package.json` | `"db:mark-abandoned-carts": "tsx app/.server/db/scripts/mark-abandoned-carts.ts"` |
| modify | `aspire-apphost/apphost.mts` | Explicit-start `db-mark-abandoned-carts` resource |
| modify | `.env.example` | Commented `ABANDONED_CART_HOURS=24` |
| modify | `README.md` | Env var row, the job, how to schedule it hourly |
| modify | `app/.server/AGENTS.md`, `aspire-apphost/AGENTS.md` | Document the job, the returning-shopper behaviour and the new resource |

## Steps
- [ ] **1. Query `markAbandonedCarts`.** In `db/queries/cart.ts` add
  `markAbandonedCarts(db: Executor, hours: number): Promise<number>`: a query-builder `update`
  with `status: "abandoned"` and `updatedAt: sql\`now()\`` (Q3), where
  `and(isActive, lt(carts.updatedAt, sql\`now() - make_interval(hours => ${hours})\`),
  exists(db.select({ one: sql\`1\` }).from(cartItems).where(eq(cartItems.cartId, carts.id))))`,
  `.returning({ id: carts.id })`, and return the row count. Check: `pnpm typecheck`.
- [ ] **2. Job module.** Create `app/.server/db/abandoned-carts.ts` with:
  - `DEFAULT_ABANDONED_CART_HOURS = 24`
  - `parseAbandonedCartHours(source: NodeJS.ProcessEnv)` → `{ ok: true; hours } | { ok: false; error }`
    (zod, `""` → default, error text names the variable and says it must be a positive whole number)
  - `markAbandonedCartsJob(db: Db, hours: number)` → `{ updated: number; message: string }`
    (message e.g. `Marked 3 carts inactive for more than 24 h as abandoned.`; English, CLI-only
    like `make-admin`'s messages, so no i18n keys).
- [ ] **3. Race handling in the cart service.** Change `lockCart` to select `status` `for update`
  and return `boolean` (true = still active). In `services/cart.ts`:
  - `addItem`: run the transaction body in a helper. If the lock reports inactive, resolve the cart
    again with `getOrCreateActiveCart` and retry once; if that fails too, throw.
  - `updateQuantity` / `removeItem`: inactive → `{ ok: false, error: "not-in-cart" }`.
  - `mergeGuestCart`: guest cart inactive → return. User cart inactive → adopt the guest cart
    (same branch as "no user cart").
  Update the file header comment that mentions #19. Check: existing `cart.test.ts` passes.
- [ ] **4. CLI script.** Create `app/.server/db/scripts/mark-abandoned-carts.ts`, mirroring
  `scripts/make-admin.ts`: load `.env` if present, parse the hours (exit 1 on error), require
  `getDatabaseUrl`, `createDb(url, 1)`, run, `console.log(message)`, close the pool in `finally`.
  Add `db:mark-abandoned-carts` to `package.json` next to the other `db:*` scripts. Check: run
  `pnpm db:mark-abandoned-carts` twice against the dev DB; the second run logs 0.
- [ ] **5. Aspire resource.** In `aspire-apphost/apphost.mts` add
  `addJavaScriptApp("db-mark-abandoned-carts", "..", { runScriptName: "db:mark-abandoned-carts" })`
  with `withPnpm({ install: false })`, `withReference(db)`, `waitForCompletion(dbMigrate)`,
  `withParentRelationship(db)` and `withExplicitStart()`, next to `db-seed`. Check:
  `pnpm aspire:build`.
- [ ] **6. Docs.** `.env.example`: commented `# ABANDONED_CART_HOURS=24` with a one-line
  explanation. README: add a row to the env table, and in the database section explain
  `pnpm db:mark-abandoned-carts`, a cron example for hourly runs, the `tsx` requirement (Q2), and
  the Aspire dashboard resource. `app/.server/AGENTS.md`: under Cart, say that abandoned carts are
  terminal, a returning shopper gets a new cart (Q1), and `lockCart` re-checks the status; under
  Database, mention the job. `aspire-apphost/AGENTS.md`: list the new resource.
- [ ] **7. Verify.** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm aspire:build`.

## Testing & verification
- **Unit** (`abandoned-carts.test.ts`): `parseAbandonedCartHours` returns the default 24 when the
  variable is unset or empty, accepts `"6"`, and rejects `"0"`, `"-1"`, `"1.5"` and `"abc"`.
- **Integration** (`abandoned-carts.test.ts`, `describe.skipIf(!hasDatabase)`, a throwaway DB from
  `createTestDatabase("jassmin_abandoned_carts_test")` plus `migrateLatest`). Insert a
  product, variant and session, then carts with `updated_at` set explicitly via
  `sql\`now() - interval '…'\``:
  - stale active cart with items → `abandoned`, `updated_at` refreshed
  - stale active **empty** cart → still `active`
  - stale **converted** cart with items → still `converted`
  - fresh active cart with items (1 h old, threshold 24) → still `active`
  - custom threshold: a 7 h-old cart is abandoned with `hours = 6` and left alone with `hours = 24`
  - second run → returns 0 and changes nothing (idempotent)
- **Integration** (`services/cart.test.ts`):
  - after a user's cart is marked abandoned, `getCartView` is empty and `addItem` creates a new
    active cart (the old one stays `abandoned`)
  - `addItem` on a cart flipped to `abandoned` between lookup and lock ends up in a new active
    cart. Simulate it by abandoning the cart, then calling the transaction path with the stale id
    (or test through `lockCart` returning `false`).
  - `updateQuantity` / `removeItem` on a just-abandoned cart → `not-in-cart`
- **Manual:** with data from the dev app, set an old `updated_at` on a cart with items
  (`update carts set updated_at = now() - interval '2 days' where id = …`), run
  `pnpm db:mark-abandoned-carts` twice (logs 1, then 0), and check that `/cart` is empty and adding
  a product starts a new cart. Under Aspire, start `db-mark-abandoned-carts` from the dashboard and
  read its log.

## Acceptance criteria
- [ ] Carts inactive beyond the threshold become `abandoned`: steps 1, 2, 4
- [ ] Empty and converted carts are not affected: step 1 (`exists` + `status = 'active'`), tests
- [ ] The threshold is configurable: steps 2, 4, 6 (`ABANDONED_CART_HOURS`)
- [ ] The job is idempotent and safe to run repeatedly: step 1 (single atomic `UPDATE` filtered on
  `active`), step 3 (no writes into an abandoned cart), tests

## Out of scope
- Abandoned-cart-rate metric on an admin route (optional in the issue; admin may move to Strapi, #40).
- Restoring an abandoned cart's items for a returning shopper (Q1 follow-up).
- Hosting-specific scheduler configuration and production deployment (Q2).
- Abandoned-cart reminder emails, and a `cart_abandoned` event in `user_events` (#18).
- An `abandoned_at` column (Q3).
