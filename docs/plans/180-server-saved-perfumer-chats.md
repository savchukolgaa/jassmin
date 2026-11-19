# Plan: Save AI perfumer chats on the server for visitors and customer accounts (#180)

Issue: https://github.com/savchukolgaa/jassmin/issues/180
Branch: `issue/180`
Worktree: `.claude/worktrees/issue-180`
Status: Planned

## Goal

A customer's conversation with the AI perfumer is saved by the shop, so it survives closing the
tab, follows a logged-in customer to another device, and the perfumer still knows what was asked.
Chats move from the browser's `sessionStorage` to PostgreSQL (`perfumer_threads`,
`perfumer_messages`), keyed by the visitor's `anonymous_id` or the customer's `user_id`. The server
builds the model's history from the stored thread, so the page sends only the new message;
customers can start a new chat or delete theirs, and a daily job deletes chats idle for 90 days.

## Dependencies & prerequisites

- #163 (chat page), #164 (streaming), #165 (`?q=` prefill), #166 (analytics events), #169 (add to
  cart from cards): all merged on `origin/main` (`app/routes/perfumer.tsx`,
  `app/routes/perfumer.stream.ts`, `app/.server/services/perfumer-chat.ts`,
  `app/features/perfumer/*`).
- #176 (production scheduler): merged; `deploy/crontab` exists and runs `pnpm` scripts in the
  `scheduler` container (`jobs` image), so a new `db:*` script is picked up without Compose changes.
- `anonymousId` cookie + `ensureVisitor` / `readVisitor` (#18) and `mergeGuestCart` from
  `onUserAuthenticated` (`app/.server/services/auth.ts`): exist.
- `getProductSummaries(publicIds)` (`app/.server/services/products.ts`) already returns only listed
  (non-archived, with variants) products as `ProductSummary`: reused for saved cards.
- New migration `0033_perfumer_chats` (+ hand-written rollback). New optional env var
  `PERFUMER_CHAT_RETENTION_DAYS` (default 90), read only by the job.
- No new packages.

## Decisions & assumptions

- **Tables** (`app/.server/db/schema.ts`, camelCase, snake_case columns):
  - `perfumer_threads`: `id serial`, `anonymous_id text not null` (the device that started it),
    `user_id integer null → users.id on delete cascade` (a chat is personal data; cart history uses
    `restrict`, chats don't need to survive the user), `entry text not null` (CHECK in
    `PERFUMER_ENTRIES`), `created_at`, `updated_at` (`updatedAt()` helper, bumped on every append),
    `closed_at timestamptz null`.
  - `perfumer_messages`: `id serial`, `thread_id → perfumer_threads.id on delete cascade`, `role`
    (CHECK `user | perfumer`), `text text null` (customer's message or the intro), `reply jsonb null`,
    `error_key text null` (CHECK: `PERFUMER_ERROR_KEYS` + `cancelled`), `created_at`.
    CHECK: a `user` row has `text`; a `perfumer` row has either `reply` or `error_key`.
  - Indexes from the issue: `(anonymous_id, closed_at)`, `(user_id, closed_at)`, `(updated_at)`,
    plus `perfumer_messages (thread_id, id)`. **Plus two partial unique indexes** enforcing "one
    active thread per owner": `(user_id) where closed_at is null and user_id is not null` and
    `(anonymous_id) where closed_at is null and user_id is null`. They make the race of two first
    messages from two tabs safe (insert `on conflict do nothing`, then select).
  - Role / error key / entry are CHECK constraints over the TS arrays (like `order_emails`), so a
    new error key is a migration that rewrites the check.
- **`reply` jsonb shape** (`StoredPerfumerReply`, validated with zod on write and read in
  `app/.server/services/perfumer-chat.schema.ts`): `{ picks: [{ productId: uuid, reason }],
  question?, replyId: uuid, turn, rating?: "up" | "down" }`. Only product ids and reasons, as the
  issue requires; `replyId` and `rating` live here so a rating survives a reload and the feedback
  intent can find the answer, without columns the issue didn't list. A row that fails to parse is
  skipped (logged), never a 500.
- **Owner.** `PerfumerOwner = { userId: number | null; anonymousId: string | undefined }`, built like
  `getCartOwner` (`getSessionUser` + `readVisitor`; a revoked session counts as a guest). A user's
  active thread is found by `user_id`; a guest's by `anonymous_id` **with `user_id is null`**, so a
  logged-out browser never shows the account's chat **(unconfirmed, Q3)**. The loader never
  creates a visitor (only `readVisitor`); actions use `ensureVisitor` as today.
- **Threads are created lazily** on the first message (no empty threads). "New chat" sets
  `closed_at` on the active thread; the next message creates a new one.
- **Writes and the model call.** One transaction locks/creates the thread (`FOR UPDATE`), appends
  the customer's message and reads the last `PERFUMER_MAX_MESSAGES` (10) stored messages for the
  history; the model call runs **outside** it; a second write saves the reply (or the error marker)
  and touches the thread. If the thread was deleted meanwhile, the save is a no-op.
- **History from the database.** `user` rows → `{ role: "user", content: text }`; `perfumer` rows
  with a reply → `replyToHistoryText` (kept in `~/lib/perfumer`) over the intro, the picks' *current*
  titles/brands (one `getProductSummaries` call) and the question; error rows are skipped. The cut
  to 10 happens after dropping errors, like `toHistory` today.
- **What is saved when.**
  - Streamed (#164): the reply (intro accumulated from `intro` events, picks, question) is saved
    once on `done`, before `done` is yielded, so a reload right after shows it. Error or cancel
    (`finally` without `done`) saves an error marker (`error_key` = `unavailable` / `timeout` /
    `cancelled`).
  - Action fallback: saved after `answerPerfumerMessage` returns, same rules.
  - Refusals before the model (`tooLong` from zod, `rateLimited`) store **nothing**: the customer's
    message isn't appended; the page shows its error bubble as today (lost on reload).
- **Retry.** The payload gets an optional `retry: true`. When the last stored row is an
  `unavailable`/`timeout` marker right after a user message, the server deletes the marker and
  answers that stored message again instead of appending a duplicate; otherwise it's a normal send.
- **Turn and entry (#166).** `turn` = number of user messages in the stored thread (capped at
  `MAX_PERFUMER_TURN`), no longer sent by the client. `entry` from the request names a new thread's
  `entry`; for an existing thread the event uses the request's entry unless it's `direct`, then the
  thread's (today's client rule, moved to the server).
- **Request** (`app/lib/perfumer.schema.ts`): `z.strictObject({ message, entry, retry? })`. A
  payload with `messages`/`turn` (old tab, or a forged history) fails → `unavailable` (400). Feedback
  keeps `replyId`/`turn`/`rating`.
- **Loader** returns `{ prefill, thread: { entry, items: ThreadItem[] } | null }`, the last
  `PERFUMER_MAX_THREAD_ITEMS` (50) messages mapped to the existing `ThreadItem` union (error rows →
  `error` with `retryText` = the preceding user text, `cancelled` → `cancelled`), cards from
  `getProductSummaries` (archived products dropped; an answer whose picks all vanished keeps its
  intro/question). It sends `Cache-Control: private, no-store` (personal content). `ThreadItem`
  keeps its shape, so `MessageThread` and the cards (#169) don't change.
- **Client.** `usePerfumerThread(initial, urlEntry)` initializes state from loader data once (SSR
  renders the saved thread, so `restored` is true from the start and the `?q=` prefill sends at
  once). `shouldRevalidate = shouldRevalidateView` stays, so posts never replace the live state.
  `thread-storage.ts` and its test are deleted; a one-line effect removes the old
  `jassmin.perfumer.thread` key once (try/catch). `toHistory` is no longer used by the client and
  moves into the service (or is deleted with its test), `replyToHistoryText` stays shared.
- **UI** (C+ strip, `PerfumerPage.tsx` → `Strip`): "Почати спочатку" becomes **"Новий чат"**
  (`perfumer.newChat`, same `RestartIcon`, `outline-light sm`), posting `intent=new-chat`; next to it
  **"Видалити чат"** (`perfumer.deleteChat`) with an inline two-step confirm (the button turns into
  "Видалити розмову? Так / Ні") **(unconfirmed, Q2)**; both post with a fetcher and clear the local
  thread optimistically, aborting any running stream. A short note under the strip title, e.g.
  "Розмова зберігається 90 днів", links to the privacy page.
- **Rating** (`intent=feedback`): unchanged event; additionally sets `reply.rating` on the owner's
  matching message (by `replyId`), best effort.
- **Delete** removes the owner's threads with their messages (cascade) **(scope unconfirmed, Q1)**.
- **Retention job** `pnpm db:prune-perfumer-chats`: `delete from perfumer_threads where updated_at <
  now() - N days` (cascade), `N` from `PERFUMER_CHAT_RETENTION_DAYS` parsed like
  `parseUnpaidOrderHours` (zod, positive int, empty = unset, default 90). Daily cron `45 3 * * *`.
  Not added to `production.mts`: the default applies there.
- **No text in analytics.** `perfumer_message` properties are unchanged (already text-free); the
  warehouse and generator read perfumer data only from `user_events`. A guard test keeps it so.

## Open questions

- [ ] **Q1: Does "Delete chat" delete only the active thread, or every thread of the owner
  (including ones closed by "New chat")?** — Why it matters: closed threads are invisible but kept
  for up to 90 days; deleting only the active one would leave text the customer can't reach or
  remove, which the privacy copy would have to explain. Recommended default: **delete all the
  owner's threads** (for a user: by `user_id`; for a guest: `anonymous_id` with `user_id is null`),
  and say "deletes your conversations" in the copy. Affects steps: 3, 6, 9.
- [ ] **Q2: Should "Delete chat" ask for confirmation, and how?** — Why it matters: it's
  irreversible; the design has no dialog component (`app/components/ui` has none). Recommended
  default: an inline two-step confirm inside the strip (no modal), keyboard- and screen-reader-
  friendly (`aria-live` announcement after deletion). Affects steps: 8.
- [ ] **Q3: After logging out, should that browser still show the account's chat?** — Why it
  matters: shared devices. Recommended default: **no**: guest lookups require `user_id is null`, so
  after logout the page starts empty (the account's chat returns after login). Affects steps: 3, 5.

## Resolved questions

- **Where does the service go?** — Extend the existing `app/.server/services/perfumer-chat.ts`
  (rate limit, engine call, analytics) and put the queries in a new
  `app/.server/db/queries/perfumer-chats.ts` (source: `app/.server/AGENTS.md` → Database: queries in
  `db/queries/<area>.ts`, rules in `services/`).
- **How are guest records found and merged at login?** — By the `anonymousId` cookie; merges run
  from `onUserAuthenticated`, each in its own try/catch so login never fails (source:
  `app/.server/services/auth.ts:136`, `app/.server/AGENTS.md` → Auth).
- **How do saved cards get current data and drop archived products?** — `getProductSummaries`
  already filters with `isListed` (source: `app/.server/services/products.ts:207`,
  `db/queries/products.ts:157`).
- **How are jobs wired?** — `db/<job>.ts` + `db/scripts/<job>.ts` CLI wrapper + `package.json`
  script + `deploy/crontab` line + explicit-start Aspire resource in `aspire-apphost/apphost.mts`
  + docs in `docs/setup.md` and `aspire-apphost/AGENTS.md` (source: `prune-rate-limits` from #143).
- **How is a job's env var read?** — From `process.env` with a zod parser and default, documented
  in `.env.example` and `docs/setup.md`, not in `envSchema` (source:
  `app/.server/db/cancel-unpaid-orders.ts`, `UNPAID_ORDER_HOURS`).
- **Does the production deploy need the env var?** — No, the default 90 applies; only a non-default
  value would go in `aspire-apphost/production.mts` (source: `AGENTS.md` → Project).
- **Where is the privacy copy?** — `privacy.*` in `app/lib/i18n/uk.ts` / `en.ts`, rendered by
  `app/features/privacy/PrivacyPolicy.tsx`; `privacy.sharing.ai` currently says no text is stored
  and must change; the date is `PRIVACY_POLICY_UPDATED_AT` in `app/lib/consent.ts`; the
  `anonymous_id` cookie's purpose is `privacy.cookies.anonymousId` (`COOKIE_INVENTORY`).
- **Does the warehouse read anything but `user_events` for the perfumer?** — No:
  `int_perfumer_messages.sql` / `mart_perfumer_daily.sql` build on `user_events`; no source names a
  perfumer table (source: `analytics/warehouse/models/staging/_sources.yml`).
- **Can the page keep skipping its loader after posts?** — Yes, and it must, so a post doesn't
  overwrite the live thread (source: `shouldRevalidateView` in `app/lib/analytics.ts:321`).

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `app/.server/db/schema.ts` | `perfumerThreads`, `perfumerMessages`, checks, indexes |
| create | `app/.server/db/migrations/0033_perfumer_chats.sql` (+ `meta/`) | generated migration |
| create | `app/.server/db/rollbacks/0033_perfumer_chats.sql` | drop both tables |
| modify | `app/.server/db/migrator.test.ts` | cascade, checks, one-active-thread uniques |
| create | `app/.server/db/queries/perfumer-chats.ts` | find/lock/create thread, append, list, save, close, delete, merge, prune |
| create | `app/.server/services/perfumer-chat.schema.ts` | zod for stored `reply` jsonb |
| modify | `app/.server/services/perfumer-chat.ts` | thread loading, history from DB, saving replies/errors, new/delete/merge |
| modify | `app/.server/services/perfumer-chat.test.ts` | service tests (unit + DB integration) |
| modify | `app/lib/perfumer.ts` | `PERFUMER_MAX_THREAD_ITEMS`, `PerfumerThreadView`, stored error keys, comments; drop client `toHistory` |
| modify | `app/lib/perfumer.schema.ts` (+ test) | `{ message, entry, retry? }` strict; `new-chat` / `delete-chat` intents |
| modify | `app/routes/perfumer.tsx` | loader returns the thread; new intents; action uses the stored thread |
| modify | `app/routes/perfumer.stream.ts` | new payload, owner, save at `done` |
| create | `app/routes/perfumer.test.ts` (or extend existing route tests) | action/stream reject client history; loader cards |
| modify | `app/.server/services/auth.ts` (+ test) | move the guest thread next to `mergeGuestCart` |
| create | `app/.server/db/prune-perfumer-chats.ts` (+ test) | the job |
| create | `app/.server/db/scripts/prune-perfumer-chats.ts` | CLI wrapper |
| modify | `package.json` | `db:prune-perfumer-chats` |
| modify | `deploy/crontab` | daily run |
| modify | `aspire-apphost/apphost.mts`, `aspire-apphost/AGENTS.md` | `db-prune-perfumer-chats` resource |
| modify | `app/features/perfumer/usePerfumerThread.ts` | start from loader data, send only the message, new/delete |
| delete | `app/features/perfumer/thread-storage.ts`, `thread-storage.test.ts` | replaced by the server |
| modify | `app/features/perfumer/PerfumerPage.tsx` (+ `PerfumerPage.dom.test.ts`) | "New chat", "Delete chat", retention note |
| modify | `app/lib/i18n/uk.ts`, `app/lib/i18n/en.ts` | perfumer buttons/notes, privacy copy |
| modify | `app/features/privacy/PrivacyPolicy.tsx`, `app/routes/privacy.tsx`, `app/lib/consent.ts` | saved-chats paragraphs, date |
| create | `app/.server/perfumer-privacy.guard.test.ts` | no perfumer tables in `analytics/` |
| modify | `.env.example`, `docs/setup.md`, `docs/ai-perfumer.md`, `docs/analytics-events.md`, `app/.server/AGENTS.md` | docs |

## Steps

- [ ] **1. Schema and migration.** Add `perfumerThreads` / `perfumerMessages` to `schema.ts` as in
  *Decisions* (explicit snake_case constraint names, CHECKs built from `PERFUMER_ENTRIES`,
  `PERFUMER_ERROR_KEYS` + `"cancelled"` exported from `~/lib/perfumer` as
  `PERFUMER_STORED_ERROR_KEYS`). `pnpm db:generate --name perfumer_chats`; review the SQL (partial
  unique indexes with `where`), write `rollbacks/0033_perfumer_chats.sql` (drop messages, then
  threads). Add `migrator.test.ts` cases: deleting a thread deletes its messages, deleting a user
  deletes their threads, a second active thread per user / per guest is refused (`23505`), bad
  role/error key refused (`23514`), rollback leaves no tables. Check: `pnpm db:migrate`,
  `pnpm db:rollback`, `pnpm db:migrate`.
- [ ] **2. Stored reply contract.** `app/.server/services/perfumer-chat.schema.ts`:
  `storedReplySchema` (`picks` 0–4 `{ productId: z.uuid(), reason: z.string().max(1000) }`,
  `question?`, `replyId: z.uuid()`, `turn`, `rating?`) and `parseStoredReply(unknown)` → value or
  `null`. In `~/lib/perfumer`: `PERFUMER_MAX_THREAD_ITEMS = 50`, `PerfumerThreadView = { entry,
  items: ThreadItem[] }`, update the "conversation isn't stored" comments. Unit-test the parser.
- [ ] **3. Queries** (`db/queries/perfumer-chats.ts`, all taking `Db | Tx`): `findActiveThread(owner)`,
  `lockOrCreateActiveThread(tx, owner, entry)` (insert `on conflict do nothing` on the partial
  unique, then `select … for update`), `appendMessage(tx, threadId, row)`, `listRecentMessages(db,
  threadId, limit)` (newest N by id, returned oldest first), `deleteLastErrorMarker(tx, threadId)`,
  `saveReplyMessage` / `saveErrorMarker` (insert only if the thread still exists, touch
  `updated_at`), `setReplyRating(db, owner, replyId, rating)` (jsonb `||`, owner-scoped join),
  `closeActiveThread(db, owner)`, `deleteOwnerThreads(db, owner)` (Q1),
  `moveGuestThreadToUser(tx, anonymousId, userId)`, `deleteThreadsIdleSince(db, cutoff)` → count.
- [ ] **4. Service** (`services/perfumer-chat.ts`):
  - `getPerfumerThreadView(owner, db?)` → `PerfumerThreadView | null` (rows → `ThreadItem`s,
    cards via `getProductSummaries`, archived dropped, unparsable rows skipped).
  - `beginPerfumerTurn({ owner, message, entry, retry })` in one transaction: lock/create thread,
    retry handling, append the user row, compute `turn`, read the last 10 messages, return
    `{ threadId, turn, entry, history }` (history built by `storedHistory`, using
    `replyToHistoryText` with current product titles).
  - Change `PerfumerChatInput` to `{ locale, owner, message, entry, retry, ipKey, sessionKey,
    signal }`: `answerPerfumerMessage` and `openPerfumerStream` admit the rate limit first (nothing
    stored when refused), then `beginPerfumerTurn`, call the engine with the DB history, and save
    the reply (`saveReplyMessage` with `replyId`, `turn`) or the marker. In the stream generator,
    accumulate `intro`/`picks`/`question`, save before yielding `done`, save the marker in `finally`
    when not done (`cancelled`) or on `error`. The `perfumer_message` event keeps its shape (`turn`
    from the DB).
  - `startNewPerfumerChat(owner)`, `deletePerfumerChat(owner)`, `ratePerfumerReply(owner, replyId,
    rating)`, `mergeGuestPerfumerThread(userId, anonymousId)` (one transaction: lock both active
    threads; none for the user → set `user_id` on the guest's; both → keep the newer `updated_at`,
    close the other first, then assign).
  - Tests (unit with fake deps + `describe.skipIf(!hasDatabase)` on `createTestDatabase()`):
    append; history from the DB with errors skipped; only the last 10 reach the engine; a forged
    assistant text can't enter (no API for it); retry replaces the marker instead of duplicating;
    stream saves at `done`, cancel/error save only the user message + marker; deleted-mid-stream
    saves nothing; new chat closes, next message opens a new thread; delete removes rows; merge
    both cases; turn counting; rate-limited stores nothing; event properties contain no message or
    intro text (assert `JSON.stringify(event)` doesn't include them).
- [ ] **5. Request schema and routes.**
  - `perfumer.schema.ts`: `perfumerRequestSchema = z.strictObject({ message: trimmed 1–500
    (TOO_LONG), entry, retry: z.literal(true).optional() })`; `parsePerfumerRequest` returns
    `{ ok, message, entry, retry }`; `perfumerChatIntentSchema` for `intent=new-chat|delete-chat`.
    Tests: old `{ messages, turn }` payload → `unavailable`; extra keys rejected; too long → `tooLong`.
  - `perfumer.tsx`: loader becomes async: `requirePerfumer()`, owner from `getSessionUser` +
    `readVisitor` (a small `getPerfumerOwner(request)` in the service, mirroring `getCartOwner`),
    returns `data({ prefill, thread }, { headers: { "Cache-Control": "private, no-store" } })`.
    Action: `new-chat` / `delete-chat` (zod) → `{ ok: true }`; `feedback` also calls
    `ratePerfumerReply`; messages use the owner (`userId` from `getSessionUser`, `anonymousId` from
    `ensureVisitor`).
  - `perfumer.stream.ts`: same payload and owner.
  - Route tests (mock the service like existing route tests): client history rejected with 400 and
    the engine not called; intents dispatch; loader returns saved cards with current prices and
    without archived products (DB integration through the service).
- [ ] **6. Login merge.** In `onUserAuthenticated`, after `mergeGuestCart`, `try {
  await mergeGuestPerfumerThread(userId, anonymousId) } catch { console.error(...) }`. Extend
  `auth.test.ts`: called with `(userId, ANONYMOUS_ID)` for login/register/reset, not called without
  a visitor, a failure doesn't fail login.
- [ ] **7. Client hook.** `usePerfumerThread({ initial, urlEntry })`: `useState(initial.items)`,
  entry = `urlEntry !== "direct" ? urlEntry : initial.entry ?? urlEntry`, `restored` always true
  (keep the field for `PerfumerPage`'s prefill effect, or drop it and simplify). `submit` posts
  `{ message: text, entry, retry? }` to the stream URL and the action fallback. `startOver` →
  `newChat()` posting `intent=new-chat` via a second `useFetcher`; add `deleteChat()` posting
  `intent=delete-chat`; both stop the stream and clear local items. Remove `thread-storage` import;
  add the one-time `sessionStorage.removeItem("jassmin.perfumer.thread")` effect. Delete
  `thread-storage.ts` and its test.
- [ ] **8. Page UI** (`PerfumerPage.tsx`, follow `docs/design.md`): pass `loaderData.thread` from the
  route; `Strip` gets "Новий чат" and "Видалити чат" (inline confirm, Q2) and the retention note;
  after a delete, an `aria-live="polite"` message ("Розмову видалено"), focus back to the input.
  i18n keys in both `uk.ts` and `en.ts`: `perfumer.newChat`, `perfumer.deleteChat`,
  `perfumer.deleteConfirm`, `perfumer.deleteYes`, `perfumer.deleteNo`, `perfumer.deleted`,
  `perfumer.savedNote` (remove `perfumer.startOver`). Update `PerfumerPage.dom.test.ts`: renders a
  thread from loader data (no `sessionStorage`), posts only `{ message, entry }`, the old storage
  key is cleared, new chat / delete post their intents and empty the thread, `?q=` prefill joins
  the saved thread, add-to-cart on a saved card still works (#169).
- [ ] **9. Privacy copy.** `privacy.collect.perfumer` (shown when the perfumer is enabled: add
  `perfumerEnabled: isPerfumerEnabled()` to the privacy loader): what is stored (messages and the
  perfumer's answers, linked to the browser id or the account), why (to continue the conversation
  across visits and devices). `privacy.retention.perfumer`: deleted 90 days after the last message,
  or at once with "Видалити чат". Rewrite `privacy.sharing.ai` ("we don't store the text" →
  "messages are sent to {provider} only to prepare the answer; don't include personal data").
  Extend `privacy.cookies.anonymousId` to mention the guest's chat. Bump
  `PRIVACY_POLICY_UPDATED_AT`. Update the privacy component test if it asserts copy.
- [ ] **10. Retention job.** `db/prune-perfumer-chats.ts`: `DEFAULT_PERFUMER_CHAT_RETENTION_DAYS =
  90`, `parsePerfumerChatRetentionDays(env)`, `prunePerfumerChatsJob(db, days, now)` → `{ deleted,
  message }`; `db/scripts/prune-perfumer-chats.ts` wrapper (exit 1 on a bad value, like
  `cancel-unpaid-orders`); `package.json` script; `deploy/crontab`: `45 3 * * * pnpm --silent
  db:prune-perfumer-chats` with a comment; `apphost.mts`: explicit-start
  `db-prune-perfumer-chats` child of `jassmindb` after `db-migrate`. Test (DB): a thread idle 91 days
  and its messages are deleted, an 89-day one stays, a second run deletes nothing; parser cases.
- [ ] **11. Analytics guard.** `app/.server/perfumer-privacy.guard.test.ts`: walk
  `analytics/generator`, `analytics/warehouse` (models, fixtures, seeds) and `analytics/notebooks`
  and fail if any file mentions `perfumer_messages` or `perfumer_threads`. Note in
  `docs/analytics-events.md` that `perfumer_message.turn` now comes from the stored thread.
- [ ] **12. Docs.** `docs/ai-perfumer.md`: rewrite "Chat page" bullets (no `sessionStorage`, one
  message per request) and add **"Saved chats"** (tables, owner rules, login merge, what is stored
  when, retry, new/delete, retention, nothing in analytics); fix "Privacy" ("stores no message
  text"). `docs/setup.md`: env table row `PERFUMER_CHAT_RETENTION_DAYS`, scripts table row and a
  "Perfumer chats" section with the cron line. `.env.example`: commented
  `# PERFUMER_CHAT_RETENTION_DAYS=90`. `aspire-apphost/AGENTS.md`: the resource.
  `app/.server/AGENTS.md`: "AI perfumer" no longer stateless; add the tables and rules.
- [ ] **13. Verify.** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`; manual checks below.

## Testing & verification

- Automated: steps 1, 2, 4, 5, 6, 8, 10, 11 (migration, stored-reply parser, service incl. DB
  integration on a throwaway database, schema/route tests, auth merge, DOM tests, prune job, guard).
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`; `pnpm db:migrate` /
  `pnpm db:rollback` round trip on the dev database.
- Manual (`pnpm aspire run`, with a local model via `AI_BASE_URL`):
  1. As a guest, ask two questions, close the browser, reopen `/parfumer`: the thread is there; a
     follow-up ("а щось схоже на другий?") uses it.
  2. Log in: the chat stays. Log in on another browser: the same chat. Log out: empty (Q3).
  3. Post a forged `payload={"messages":[…]}` with curl: 400, nothing stored.
  4. "Новий чат" empties the page and a reload stays empty; "Видалити чат" → rows gone in
     `psql` (`select count(*) from perfumer_messages`).
  5. Archive a picked product in Strapi: the saved answer reloads without its card; change a price:
     the card shows the new price.
  6. Cancel a streaming reply, reload: the message and a "cancelled" note are shown.
  7. Set `updated_at` back 91 days, start `db-prune-perfumer-chats` in the Aspire dashboard: gone.
  8. `select event_properties from user_events where event_type = 'perfumer_message'`: no text.

## Acceptance criteria

- [ ] After closing and reopening the browser, the customer's perfumer chat is still there, and a
  follow-up question uses the earlier messages — steps 1, 3, 4, 5, 7
- [ ] A guest's chat is kept after login, and a logged-in customer sees the same chat on another
  device — steps 4, 5, 6
- [ ] The server ignores any history sent by the client; only stored messages reach the model —
  steps 4, 5
- [ ] Customers can start a new chat and delete their chat; a deleted chat is gone from the
  database — steps 3, 4, 5, 7, 8
- [ ] Chats older than 90 days are deleted by the daily job, scheduled in `deploy/crontab` and
  runnable from Aspire — step 10
- [ ] Message text never appears in `user_events`, the analytics generator or the warehouse —
  steps 4, 11
- [ ] The privacy policy (uk/en) describes the saved chats and their retention — step 9
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass — step 13

## Out of scope

- A list of past chats, reopening a closed thread.
- Summarising long chats for the model (still the last 10 messages).
- Staff reading chats in Strapi; exporting chats.
- Importing old `sessionStorage` threads to the server (they are cleared once).
- Storing refused messages (`tooLong`, `rateLimited`).
- Any change to the engine (`app/.server/ai/*`), prompts or the eval.
