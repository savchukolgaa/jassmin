# Plan: Add scheduled job to mark inactive carts as abandoned (#19)

Issue: https://github.com/savchukolgaa/jassmin/issues/19
Branch: `issue/19`
Worktree: `.claude/worktrees/issue-19`
Status: Implemented

## Goal
As a data analyst, I want inactive carts to be marked `abandoned` automatically, so that I can
measure the abandoned-cart rate and use it in churn models. A standalone CLI job, run hourly by an
external scheduler, flips `active` carts that have items and no activity for
`ABANDONED_CART_HOURS` (default 24) to `abandoned`, records when in a new `carts.abandoned_at`
column, and logs how many it changed.

## Dependencies & prerequisites
- **#10 (cart), closed and on `main`.** `carts.status`, `carts.updated_at` (`$onUpdate`), the
  `touchCart` call at the end of every cart change, and the index
  `carts_status_updated_at_idx (status, updated_at)` ("For the abandoned-cart job (#19)") already
  exist in `app/.server/db/schema.ts` / `db/queries/cart.ts`.
- **#11 (checkout), still open.** It will set `converted`. This job only touches `active` carts, so
  it doesn't depend on #11. The "converted carts are not affected" test inserts a `converted` cart
  directly.
- **One migration:** `0006_cart_abandoned_at` adds the nullable column `carts.abandoned_at`, with
  a hand-written rollback in `db/rollbacks/`.
- New env var `ABANDONED_CART_HOURS` (optional, positive integer, default 24). No new packages:
  the CLI runs with `tsx`, like the other `db:*` scripts.

## Decisions & assumptions
- **New column `carts.abandoned_at` (`timestamptz`, nullable), and `updated_at` is left alone**
  (answer to Q3). `abandoned_at` is when the job marked the cart. `updated_at` keeps the shopper's
  last activity, which is the churn feature analysts need. Time from last activity to abandonment
  is `abandoned_at - updated_at`. So the job's update sets `updated_at` to itself
  (`updatedAt: sql\`${carts.updatedAt}\``), which overrides the `$onUpdate` hook. This is a
  documented exception to "updates refresh `updated_at`". The column is an ML feature, so it falls
  under the "never drop or rename" rule in `AGENTS.md`.
- **Backfill in the migration:** `update carts set abandoned_at = updated_at where status =
  'abandoned'`. Production most likely has no such rows yet, but the column shouldn't contradict
  the status. **No CHECK constraint** ties `abandoned_at` to `status`. Existing tests insert
  `abandoned` carts without it (`migrator.test.ts`), and the job is the only writer. Add one in a
  later migration if other writers appear.
- **No new index.** The job filters on `(status, updated_at)`, which `carts_status_updated_at_idx`
  already covers. Analytics queries on `abandoned_at` are offline.
- **Location follows the repo's CLI pattern instead of the issue's `scripts/` path.** All DB CLIs
  live in `app/.server/db/scripts/*.ts`, run through a `pnpm db:*` script with `tsx`, and keep their
  logic in a testable module next to them (`db/seed.ts` + `scripts/seed.ts`,
  `db/make-admin.ts` + `scripts/make-admin.ts`). The root `scripts/` only holds `aspire.mjs`, and
  Vitest only includes `app/**/*.test.ts`. So:
  - query: `markAbandonedCarts(db, hours)` in `app/.server/db/queries/cart.ts`
  - logic plus env parsing: `app/.server/db/abandoned-carts.ts`
  - CLI: `app/.server/db/scripts/mark-abandoned-carts.ts` and `pnpm db:mark-abandoned-carts`
- **The query uses the Drizzle query builder, not raw SQL:**
  `db.update(carts).set({ status: "abandoned", abandonedAt: sql\`now()\`, updatedAt: sql\`${carts.updatedAt}\` })`
  with `status = 'active'`, `updated_at < now() - make_interval(hours => $hours)` and
  `exists (select 1 from cart_items where cart_id = carts.id)`, then `.returning({ id })` and
  count the rows. Times come from the database clock (`now()`), never from JS `new Date()`, so
  app and DB clock skew can't move the threshold.
- **Idempotency comes from the `status = 'active'` filter.** A second run finds nothing to change
  and logs 0, and `abandoned_at` keeps the time of the first run. A single `UPDATE` statement is
  atomic, so a crash halfway changes nothing.
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
- **A returning shopper gets a new, empty active cart** (answer to Q1). The cart lookups
  (`findActiveUserCartId`, `findActiveGuestCartId`) only see `active` carts, so after abandonment
  the cart disappears from the header and `/cart`, and the next `addItem` creates a new cart.
  `abandoned` is a terminal status, so the rate stays clean. This is documented in
  `app/.server/AGENTS.md` (Cart section) and the README. Restoring the items is a follow-up issue.
- **Scheduling** (answer to Q2): the README documents a system cron entry
  (`0 * * * * cd /srv/jassmin && pnpm db:mark-abandoned-carts`) and that `tsx`, a devDependency,
  must be installed where it runs. Hosting-specific cron belongs to the deploy issue. Under Aspire,
  the job gets an explicit-start resource `db-mark-abandoned-carts` (child of `jassmindb`, like
  `db-seed`), because only Aspire knows its database password.

## Resolved questions
- **Q1: What does a returning shopper get?** A new, empty active cart (the issue's first option,
  which needs no extra cart code); restoring items is a follow-up (source: user, after
  `/create-plan 19`).
- **Q2: Scheduling in production?** Document a system cron entry and the `tsx` requirement in the
  README; hosting-specific setup goes with deployment (source: user).
- **Q3: Overwrite `updated_at` on abandonment?** No. Add `carts.abandoned_at` now and keep
  `updated_at` as the last activity (source: user).
- **Does the job need a new index?** No. `carts_status_updated_at_idx` was added for #19 in #10
  (source: `app/.server/db/schema.ts`, the `carts` table).
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
- **What must change with a new `carts` column?** The `Cart` mirror in `app/lib/commerce.ts`
  (`schema.test.ts` fails if they drift), the `carts` column expectations in `schema.test.ts`, and
  the latest-tag assertions in `migrator.test.ts` (today `0005_cart_active_unique`) (source: those
  files, `app/.server/AGENTS.md` → Database).
- **Node cron / custom Express server?** Not applicable. The app uses `react-router-serve` with no
  custom server (source: `package.json` `start`), so the job runs as a separate process.
- **Optional admin metric?** Left out: it's optional in the issue, and #40 may replace the in-app
  admin with Strapi (source: #19, #40).

## Files
| Action | Path | Purpose |
|--------|------|---------|
| modify | `app/.server/db/schema.ts` | `carts.abandonedAt` (nullable `timestamptz`) |
| create | `app/.server/db/migrations/0006_cart_abandoned_at.sql` (+ `meta/`) | Generated by `pnpm db:generate --name cart_abandoned_at`, plus the hand-added backfill |
| create | `app/.server/db/rollbacks/0006_cart_abandoned_at.sql` | `ALTER TABLE "carts" DROP COLUMN "abandoned_at";` |
| modify | `app/lib/commerce.ts` | `Cart.abandonedAt: Date \| null` |
| modify | `app/.server/db/schema.test.ts` | Expect the new column |
| modify | `app/.server/db/migrator.test.ts` | Latest tag `0006_cart_abandoned_at`; column, backfill and rollback checks |
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
| modify | `app/.server/AGENTS.md`, `aspire-apphost/AGENTS.md` | Document the column, the job, the returning-shopper behaviour and the new resource |

## Steps
- [x] **1. Column and migration.** In `schema.ts` add
  `abandonedAt: timestamp({ withTimezone: true })` to `carts` (nullable, with a comment: set by the
  abandoned-cart job; `updated_at` stays the last activity). Run
  `pnpm db:generate --name cart_abandoned_at`, then append the backfill
  (`--> statement-breakpoint` then `UPDATE "carts" SET "abandoned_at" = "updated_at" WHERE "status" = 'abandoned';`)
  to the generated SQL. Write `db/rollbacks/0006_cart_abandoned_at.sql` with a header comment like
  `0005`'s. Add `abandonedAt: Date | null` to `Cart` in `app/lib/commerce.ts`, and update
  `schema.test.ts` plus the `0005` → `0006` latest-tag assertions in `migrator.test.ts`. Check:
  `pnpm typecheck`, and `pnpm test` with a database (migrate, then roll back).
- [x] **2. Query `markAbandonedCarts`.** In `db/queries/cart.ts` add
  `markAbandonedCarts(db: Executor, hours: number): Promise<number>`: a query-builder `update`
  setting `status: "abandoned"`, `abandonedAt: sql\`now()\`` and
  `updatedAt: sql\`${carts.updatedAt}\`` (keeps the last activity; comment why), where
  `and(isActive, lt(carts.updatedAt, sql\`now() - make_interval(hours => ${hours})\`),
  exists(db.select({ one: sql\`1\` }).from(cartItems).where(eq(cartItems.cartId, carts.id))))`,
  `.returning({ id: carts.id })`, and return the row count. Check: `pnpm typecheck`.
- [x] **3. Job module.** Create `app/.server/db/abandoned-carts.ts` with:
  - `DEFAULT_ABANDONED_CART_HOURS = 24`
  - `parseAbandonedCartHours(source: NodeJS.ProcessEnv)` → `{ ok: true; hours } | { ok: false; error }`
    (zod, `""` → default, error text names the variable and says it must be a positive whole number)
  - `markAbandonedCartsJob(db: Db, hours: number)` → `{ updated: number; message: string }`
    (message e.g. `Marked 3 carts inactive for more than 24 h as abandoned.`; English, CLI-only
    like `make-admin`'s messages, so no i18n keys).
- [x] **4. Race handling in the cart service.** Change `lockCart` to select `status` `for update`
  and return `boolean` (true = still active). In `services/cart.ts`:
  - `addItem`: run the transaction body in a helper. If the lock reports inactive, resolve the cart
    again with `getOrCreateActiveCart` and retry once; if that fails too, throw.
  - `updateQuantity` / `removeItem`: inactive → `{ ok: false, error: "not-in-cart" }`.
  - `mergeGuestCart`: guest cart inactive → return. User cart inactive → adopt the guest cart
    (same branch as "no user cart").
  Update the file header comment that mentions #19. Check: existing `cart.test.ts` passes.
- [x] **5. CLI script.** Create `app/.server/db/scripts/mark-abandoned-carts.ts`, mirroring
  `scripts/make-admin.ts`: load `.env` if present, parse the hours (exit 1 on error), require
  `getDatabaseUrl`, `createDb(url, 1)`, run, `console.log(message)`, close the pool in `finally`.
  Add `db:mark-abandoned-carts` to `package.json` next to the other `db:*` scripts. Check: run
  `pnpm db:mark-abandoned-carts` twice against the dev DB; the second run logs 0.
- [x] **6. Aspire resource.** In `aspire-apphost/apphost.mts` add
  `addJavaScriptApp("db-mark-abandoned-carts", "..", { runScriptName: "db:mark-abandoned-carts" })`
  with `withPnpm({ install: false })`, `withReference(db)`, `waitForCompletion(dbMigrate)`,
  `withParentRelationship(db)` and `withExplicitStart()`, next to `db-seed`. Check:
  `pnpm aspire:build`.
- [x] **7. Docs.** `.env.example`: commented `# ABANDONED_CART_HOURS=24` with a one-line
  explanation. README: add a row to the env table, and in the database section explain
  `pnpm db:mark-abandoned-carts`, the hourly cron example, the `tsx` requirement, and the Aspire
  dashboard resource. `app/.server/AGENTS.md`: under Database, describe `abandoned_at` (set only by
  the job; the job leaves `updated_at` as the last activity, an exception to the `$onUpdate` rule)
  and the job; under Cart, say that abandoned carts are terminal, a returning shopper gets a new
  cart, and `lockCart` re-checks the status. `AGENTS.md`: add `carts.abandoned_at` to the ML
  feature columns. `aspire-apphost/AGENTS.md`: list the new resource.
- [x] **8. Verify.** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm aspire:build`.

## Testing & verification
- **Unit** (`abandoned-carts.test.ts`): `parseAbandonedCartHours` returns the default 24 when the
  variable is unset or empty, accepts `"6"`, and rejects `"0"`, `"-1"`, `"1.5"` and `"abc"`.
- **Migration** (`migrator.test.ts`): after `migrateLatest`, `carts.abandoned_at` exists and is
  nullable. An `abandoned` cart created before `0006` gets `abandoned_at = updated_at`, while
  other carts stay `null`. `rollbackLatest` returns `0006_cart_abandoned_at` and drops the column.
- **Integration** (`abandoned-carts.test.ts`, `describe.skipIf(!hasDatabase)`, a throwaway DB from
  `createTestDatabase("jassmin_abandoned_carts_test")` plus `migrateLatest`). Insert a
  product, variant and session, then carts with `updated_at` set explicitly via
  `sql\`now() - interval '…'\``:
  - stale active cart with items → `abandoned`, `abandoned_at` set to about now, `updated_at`
    **unchanged**
  - stale active **empty** cart → still `active`, `abandoned_at` null
  - stale **converted** cart with items → still `converted`, `abandoned_at` null
  - fresh active cart with items (1 h old, threshold 24) → still `active`
  - custom threshold: a 7 h-old cart is abandoned with `hours = 6` and left alone with `hours = 24`
  - second run → returns 0 and leaves `abandoned_at` as the first run set it (idempotent)
- **Integration** (`services/cart.test.ts`):
  - after a user's cart is marked abandoned, `getCartView` is empty and `addItem` creates a new
    active cart (the old one stays `abandoned`)
  - `addItem` on a cart flipped to `abandoned` between lookup and lock ends up in a new active
    cart. Simulate it by abandoning the cart, then calling the transaction path with the stale id
    (or test through `lockCart` returning `false`).
  - `updateQuantity` / `removeItem` on a just-abandoned cart → `not-in-cart`
- **Manual:** with data from the dev app, set an old `updated_at` on a cart with items
  (`update carts set updated_at = now() - interval '2 days' where id = …`), run
  `pnpm db:mark-abandoned-carts` twice (logs 1, then 0), and check `abandoned_at` / `updated_at` in
  the row. Then check that `/cart` is empty and adding a product starts a new cart. Under Aspire,
  start `db-mark-abandoned-carts` from the dashboard and read its log.

## Acceptance criteria
- [x] Carts inactive beyond the threshold become `abandoned`: steps 1, 2, 3, 5
- [x] Empty and converted carts are not affected: step 2 (`exists` + `status = 'active'`), tests
- [x] The threshold is configurable: steps 3, 5, 7 (`ABANDONED_CART_HOURS`)
- [x] The job is idempotent and safe to run repeatedly: step 2 (single atomic `UPDATE` filtered on
  `active`), step 4 (no writes into an abandoned cart), tests

## Out of scope
- Abandoned-cart-rate metric on an admin route (optional in the issue; admin may move to Strapi, #40).
- Restoring an abandoned cart's items for a returning shopper (follow-up issue).
- Hosting-specific scheduler configuration and production deployment.
- Abandoned-cart reminder emails, and a `cart_abandoned` event in `user_events` (#18).
- A CHECK constraint tying `abandoned_at` to `status`.
