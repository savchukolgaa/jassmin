# Plan: Add password reset and email verification (#135)

Issue: https://github.com/savchukolgaa/jassmin/issues/135
Branch: `issue/135`
Worktree: `.claude/worktrees/issue-135`
Status: Planned

## Goal

A registered customer who forgets their password can ask for a one-time link by email (valid for
1 hour) and set a new one. That logs them in and logs out their other sessions, so they keep their
account and order history instead of registering again. New accounts get an email verification
link, and the account page shows a "Confirm your email" banner with a resend button until the
address is confirmed. Verification is soft: unverified users can still log in and order.

## Dependencies & prerequisites

- **#9 login/registration**: done (`services/auth.ts`, `session.ts`, `rate-limit.ts`, `password.ts`,
  `routes/login.tsx`, `routes/register.tsx`).
- **#134 production email**: **open**. It brings the real SMTP provider and "one branded HTML +
  text layout" for every email. Nothing here blocks on it: we send through the existing
  `getMailTransport()` (`SMTP_URL`, smtp4dev under Aspire), and locally it works with smtp4dev.
  Emails are plain text for now (Q1).
- `PUBLIC_SITE_URL` already exists (`app/.server/env.ts`, `getSiteUrl(env, request)`: required in
  production, the request origin otherwise). No new env variables.
- One migration, `0024_auth_tokens` (`pnpm db:generate --name auth_tokens`), plus its hand-written
  rollback `app/.server/db/rollbacks/0024_auth_tokens.sql`.
- No new packages: `node:crypto` provides `randomBytes` and `createHash("sha256")`.

## Decisions & assumptions

- **One `auth_tokens` table** with a `purpose` column (`AUTH_TOKEN_PURPOSES` in `~/lib/enums`:
  `password_reset` | `email_verification`, limited by a CHECK `auth_tokens_purpose_check`), not
  two tables: both have the same columns and lifecycle. Columns are `id`, `user_id` (FK to `users`,
  `on delete cascade`), `purpose`, `token_hash` (`varchar(64)`, the hex SHA-256,
  `auth_tokens_token_hash_unique`), `expires_at`, `used_at` (nullable) and `created_at`. There's
  an index on `(user_id, purpose)`.
- **Tokens** are 32 random bytes (`randomBytes(32).toString("base64url")`, 43 characters, 256
  bits). Only `sha256(token)` hex is stored. The raw token appears only in the emailed link. Being
  random, the token needs no salt or slow hash, so a lookup by hash is enough.
- **Lifetimes**: password reset is 1 hour (issue). Email verification is 7 days (Q3).
  Both are constants in `~/lib/auth`: `PASSWORD_RESET_TTL_MINUTES = 60` and
  `EMAIL_VERIFICATION_TTL_HOURS = 168`.
- **Single use is atomic.** `consumeAuthToken(tx, purpose, hash, now)` runs inside a transaction:
  `SELECT … FOR UPDATE` by hash and purpose, then classifies the row (`unknown`, `used` or
  `expired`; otherwise it sets `used_at = now` and returns `userId`). Two concurrent submits of one
  link can't both succeed. A successful reset also marks every other unused `password_reset`
  token of that user as used, and a successful verification does the same for
  `email_verification` tokens. Resending does **not** invalidate earlier links, so the first email
  still works until it expires.
- **Typed token errors**: `AuthTokenError = "unknown" | "used" | "expired"` in `~/lib/auth`, each
  with a message key (`auth.tokens.errors.*`) and a "request a new link" call to action.
- **Reads in loaders, writes in actions** (AGENTS.md): the reset and verify pages' loaders only
  *check* the token (`inspectAuthToken`, no write) and render the form or the error. Consuming the
  token happens in the action. A link previewed or prefetched by a mail scanner therefore never
  uses up the token. For verification, the page shows one "Confirm my email" button that POSTs
 .
- **Revoking other sessions with a cookie session store**: there's no server-side session table
  (`session.ts` uses `createCookieSessionStorage`). `createUserSession` stores a new
  `SessionData.authenticatedAt` (epoch ms). `users.password_changed_at` is set on a reset. When
  loading the session user, the session is rejected (treated as logged out) when
  `password_changed_at` is set and `authenticatedAt` is missing or earlier than it. The reset
  action passes the same `Date` to the DB update and to `createUserSession`, so the new session
  survives. `timestamptz` keeps JavaScript's millisecond precision exactly, so a strict `<`
  comparison is safe. Cookies from before this change have no `authenticatedAt` and stay valid
  until that user's first password change.
- **Where the check lives**: `getUser` (and so `requireUser`/`requireAdmin`) does the check through
  a new query `findSessionUser(db, id)` (the `PublicUser` fields plus `passwordChangedAt`).
  `services/cart.ts` reads the bare `getUserId` today, so a revoked cookie would still load that
  user's cart. It switches to the validated user id. `analytics.ts` keeps `getUserId`: it only
  attributes events, and an event from a revoked cookie is harmless.
- **Same answer for unknown emails, timing included**: the forgot-password action validates the
  email, checks the rate limits, counts the hit (for every email, registered or not), then
  starts `void requestPasswordReset(...)` and immediately returns `{ sent: true }`. Looking up the
  user, inserting the token and sending the email all run after the response. The response is
  the same and takes the same time whether the account exists or not. `requestPasswordReset`
  never rejects (like `notifyEmailChanged`).
- **Rate limits** (issue): `passwordResetLimiters` in `rate-limit.ts`: `byEmail` 3 per hour, `byIp`
  10 per hour, fixed window, on the same `globalThis` HMR pattern as `loginLimiters`. Every
  accepted request counts (not only failures), so the limit itself reveals nothing about whether
  an account exists. When blocked, the action returns the typed `auth.errors.tooManyRequests`
  (429). Resending the verification email uses `verificationEmailLimiter`: 3 per user id per hour.
- **Delivery is direct and best effort**, like `notifyEmailChanged`: no outbox, because the user
  can ask again and a stale reset link is worse than none. Without `SMTP_URL` nothing is sent and
  the attempt is logged.
- **Email content**: plain text built like `buildEmailChangedNotice` (`Mail.Options`, from
  `CONTACT_FROM`, `replyTo: CONTACT_INBOX`, name through `stripLineBreaks`), in the locale of the
  request that triggered it (`getLocale(request)`; users have no stored locale). The link is
  `getSiteUrl(env, request) + pathFor(locale, "resetPassword" | "verifyEmail", { token })`. There's
  one builder per email (`buildPasswordResetEmail`, `buildVerificationEmail`), so #134's layout can
  wrap them later.
- **A reset also verifies the email** (`email_verified_at = coalesce(email_verified_at, now)`):
  following the link proves the user owns the address.
- **After a reset**: `touchLastLogin` (an ML feature), `loginLimiters.byEmail.reset(email)`,
  `onUserAuthenticated(…, "password_reset")` (the `login` event gets `method: "password_reset"`,
  with `kind` widened), then `createUserSession` redirects to `/kabinet`.
- **Token pages leak nothing**: the reset and verify pages answer with `Referrer-Policy: no-referrer`
  and `Cache-Control: no-store` (route `headers`), so the token never reaches a third-party
  `Referer` or a cache. They are `indexable: false` (`noindexMeta`).
- **Implementation notes.** The three pages are registered in `routes.ts` together with their
  route modules in step 7, since typegen needs the files. Message keys that a schema needs are
  added in the step that uses them (e.g. `auth.errors.passwordMismatch` in step 4), not all in
  step 9. `getUser` and the cart's owner share `getSessionUser` (`services/session-user.ts`),
  because `services/auth.ts` imports the cart service and the cart service can't import it back.
  Both emails share `services/auth-emails.ts` (`buildPasswordResetEmail`,
  `buildVerificationEmail`, `authLink` and the injectable `AuthEmailDeps`). The whole copy for
  the feature (`auth.forgot`, `auth.reset`, `auth.verify`, `auth.tokens`,
  `account.verifyBanner`) went in with step 5. `setPasswordChanged` serves both the reset and
  the profile's password change. The profile's "saved" messages now say that other devices are
  logged out and that the new address got a confirmation link. The three new pages are also
  in `ROBOTS_PRIVATE_PAGES` (`seo/robots.ts`), like login and register.
- **Existing users** start with `email_verified_at = null` (no backfill), as the issue says. They
  see the banner and can verify from it. Nothing is forced.
- The banner lives on the account index page (`account._index.tsx`) and its resend button posts to
  that route's action (`intent=resend-verification`). It doesn't live in the `account.tsx` layout,
  where a POST to `/kabinet` would be ambiguous between the layout and the index route.

## Resolved questions

The user accepted every recommended default (2026-11-05):

- **Q1: HTML layout for these emails?** Plain text now, through dedicated builders
  (`buildPasswordResetEmail`, `buildVerificationEmail`) that #134 wraps in its layout later.
  Steps 5, 6.
- **Q2: Does the profile page's password change also log out other sessions?** Yes, with the same
  `password_changed_at` mechanism. The current session stays logged in because its cookie is
  re-issued with the same `authenticatedAt`. Steps 3, 8.
- **Q3: How long is a verification link valid?** 7 days (`EMAIL_VERIFICATION_TTL_HOURS = 168`).
  The account page can always resend. Steps 1, 6.
- **Q4: One click, or the link plus a button?** The link opens a page with a "Confirm my email"
  button (POST). The loader only checks the token, so writes stay in actions and mail scanners
  can't use up the link. Step 7.
- **Q5: Does an email change on the profile reset verification?** Yes: `updateUserEmail` sets
  `email_verified_at = null`, and the profile action sends a verification email to the new
  address. Step 8.

- **Is there a server-side session store to revoke sessions in?** No. The cookie session storage
  has no store, so revocation is the `authenticatedAt` vs `password_changed_at` check (source:
  `app/.server/session.ts`, `app/.server/AGENTS.md` → Profile).
- **Is there a site URL for absolute links?** Yes: `getSiteUrl(env, request)` with
  `PUBLIC_SITE_URL`, which production requires (source: `app/.server/env.ts`).
- **How are auth emails sent today?** Directly, best effort and plain text, through an injectable
  `MailSender` (source: `notifyEmailChanged` in `app/.server/services/profile.ts`,
  `app/.server/mail.ts`).
- **What are the password rules?** `newPasswordSchema`: 8–128 characters, not trimmed (source:
  `app/lib/auth.schema.ts`).
- **How do pages get localized paths?** Through the `PAGES` table. `routes.ts` registers both
  languages from it, and `indexable: false` keeps a page out of the sitemap and `hreflang`
  (source: `app/lib/paths.ts`, `app/routes.ts`).
- **What does a rate limiter look like?** `createRateLimiter` and the `globalThis` singletons;
  `getClientIp` for the IP key (source: `app/.server/rate-limit.ts`).
- **Who reads the session user without the DB?** `services/cart.ts` and `analytics.ts`, through
  `getUserId` (source: grep for `getUserId`).

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `app/.server/db/schema.ts` | `users.emailVerifiedAt`, `users.passwordChangedAt`, `authTokens` table |
| create | `app/.server/db/migrations/0024_auth_tokens.sql` (+ `meta/`) | generated migration |
| create | `app/.server/db/rollbacks/0024_auth_tokens.sql` | drop the table and the two columns |
| modify | `app/lib/enums.ts` (+ test) | `AUTH_TOKEN_PURPOSES` |
| create | `app/.server/auth-tokens.ts` (+ test) | `generateAuthToken`, `hashAuthToken` |
| create | `app/.server/db/queries/auth-tokens.ts` (+ test) | insert, inspect, consume, invalidate |
| modify | `app/.server/db/queries/users.ts` (+ test) | `findSessionUser`, `setPasswordAfterReset`, `markEmailVerified`, `PublicUser.emailVerified`; `updateUserEmail` clears verification (Q5) |
| modify | `app/.server/session.ts` (+ test) | `SessionData.authenticatedAt`, set in `createUserSession`; `isSessionRevoked` |
| modify | `app/.server/services/auth.ts` (+ test) | `getUser` rejects revoked sessions; `kind` adds `"password_reset"` |
| modify | `app/.server/services/cart.ts` (+ test) | use the validated user id |
| modify | `app/.server/rate-limit.ts` (+ test) | `passwordResetLimiters`, `verificationEmailLimiter` |
| create | `app/.server/services/password-reset.ts` (+ test) | `requestPasswordReset`, `buildPasswordResetEmail`, `inspectResetToken`, `resetPassword` |
| create | `app/.server/services/email-verification.ts` (+ test) | `sendVerificationEmail`, `buildVerificationEmail`, `inspectVerificationToken`, `verifyEmail` |
| modify | `app/lib/auth.ts` (+ test) | TTL constants, `AuthTokenError`, field types |
| modify | `app/lib/auth.schema.ts` (+ `auth.test.ts`) | `forgotPasswordSchema`, `resetPasswordSchema`, `authTokenSchema` |
| modify | `app/lib/paths.ts` (+ tests) | `forgotPassword`, `resetPassword`, `verifyEmail` |
| modify | `app/routes.ts` | register the three pages under `_shop` |
| create | `app/routes/forgot-password.tsx` (+ test) | form and generic answer |
| create | `app/routes/reset-password.tsx` (+ test) | token check and new-password form |
| create | `app/routes/verify-email.tsx` (+ test) | token check and confirm button |
| modify | `app/routes/login.tsx` (+ test) | "Forgot password?" link |
| modify | `app/routes/register.tsx` (+ test) | send the verification email |
| modify | `app/routes/account._index.tsx` (+ test) | banner loader data and resend action |
| modify | `app/routes/account.profile.tsx`, `app/.server/services/profile.ts` (+ tests) | Q2, Q5 |
| create | `app/features/account/VerifyEmailBanner.tsx` (+ `account-ui.test.ts`) | the banner |
| modify | `app/features/auth/AuthLayout.tsx` | allow a frame without the login/register tabs, for the new pages |
| modify | `app/lib/i18n/uk.ts`, `app/lib/i18n/en.ts` | `auth.forgot.*`, `auth.reset.*`, `auth.verify.*`, `auth.tokens.errors.*`, mail copy, `account.verifyBanner.*` |
| modify | `app/.server/AGENTS.md` | document tokens, revocation, limits; update the Profile line |

## Steps

Each step is small, ordered, and leaves the app in a working state.

- [x] **1. Schema and migration.** In `schema.ts`, add `emailVerifiedAt` and `passwordChangedAt`
  (`timestamp({ withTimezone: true })`, nullable) to `users`. Add the `authTokens` table described
  in Decisions, with explicit snake_case constraint names: `auth_tokens_token_hash_unique`,
  `auth_tokens_purpose_check` built from `AUTH_TOKEN_PURPOSES`, and the index
  `auth_tokens_user_id_purpose_idx`. Add `AUTH_TOKEN_PURPOSES` to `~/lib/enums` and the TTL
  constants to `~/lib/auth`. Run `pnpm db:generate --name auth_tokens`, then write
  `rollbacks/0024_auth_tokens.sql` (`DROP TABLE auth_tokens; ALTER TABLE users DROP COLUMN
  password_changed_at, DROP COLUMN email_verified_at;`). Check: the migrator test applies and
  rolls back on a test DB, and `schema.test.ts` stays green.
- [x] **2. Token primitives and queries.** In `app/.server/auth-tokens.ts`: `generateAuthToken()`
  → `{ token, hash }` and `hashAuthToken(token)` (hex SHA-256). In `db/queries/auth-tokens.ts`:
  - `insertAuthToken(db, { userId, purpose, hash, expiresAt })`;
  - `inspectAuthToken(db, purpose, hash, now)`, which returns `{ ok: true, userId }` or
    `{ ok: false, error }` and doesn't write;
  - `consumeAuthToken(tx, purpose, hash, now)`, which does `SELECT … FOR UPDATE`, then classifies
    the row or sets `used_at`;
  - `invalidateUserTokens(tx, userId, purpose, now)`.

  Unit tests: hashing is deterministic, 64 hex characters, and differs from the raw token. DB
  tests: unknown, expired and used tokens are rejected; a second consume returns `used`; two
  concurrent consumes yield exactly one success.
- [x] **3. Session revocation.** Add `authenticatedAt?: number` to `SessionData`, and an optional
  `authenticatedAt: Date` to `createUserSession` (default `new Date()`). Add a pure
  `isSessionRevoked(authenticatedAt, passwordChangedAt)` in `session.ts`, and export
  `getSessionAuth(request)` → `{ userId, authenticatedAt }`. Add `findSessionUser` in `users.ts`
  (`PublicUser` plus `passwordChangedAt`; `PublicUser` gains `emailVerified: boolean`). `getUser`
  returns `null` when the session is revoked. `services/cart.ts` uses `(await getUser(request))?.id`
  instead of `getUserId`. Tests: a cookie from before the change is rejected after a password
  change, a cookie issued at the change survives, and a cookie without `authenticatedAt` stays
  valid while `password_changed_at` is null.
- [x] **4. Schemas, paths and routes skeleton.** In `auth.schema.ts`:
  - `authTokenSchema`: `z.string().regex(/^[A-Za-z0-9_-]{43}$/)`;
  - `forgotPasswordSchema`: `{ email: emailSchema }`;
  - `resetPasswordSchema`: `{ password: newPasswordSchema, confirmPassword }`, with a refine on
    mismatch (`auth.errors.passwordMismatch`).

  Add the three `PAGES` entries (paths from the issue, `indexable: false`) and register them with
  `localizedRoute` inside the `_shop` layout. Update the `paths` tests (both languages resolve,
  and none of the three pages is in the sitemap). Add the `rate-limit.ts` limiters and their tests
  (3 per email, 10 per IP and 3 per user, each per hour).
- [x] **5. Password reset service.** In `services/password-reset.ts`, with deps injectable like
  `EmailChangedDeps` (`db`, `mailer`, `env`, `now`):
  - `requestPasswordReset({ email, locale, siteUrl })` → when a user exists, inserts a token that
    expires in 60 minutes and sends `buildPasswordResetEmail` (greeting, link, "valid for 1 hour",
    "ignore if this wasn't you", signature). It never rejects.
  - `resetPassword({ token, password, now })` runs one transaction:
    1. `consumeAuthToken`;
    2. `setPasswordAfterReset` (`password_hash`, `password_changed_at = now`,
       `email_verified_at = coalesce(…, now)`);
    3. `invalidateUserTokens(password_reset)`.

    It returns `{ ok: true, userId, email }` or the typed token error.

  Tests:
  - the email contains the absolute localized link and the raw token, and the DB holds only its
    hash;
  - an unknown email sends nothing and doesn't throw;
  - the link works once and expires after 1 hour (injected `now`);
  - other reset tokens are invalidated;
  - `password_changed_at` is set.
- [x] **6. Email verification service.** In `services/email-verification.ts`:
  - `sendVerificationEmail({ userId, email, fullName, locale, siteUrl })` inserts a 7-day token
    and sends `buildVerificationEmail`. It's best effort.
  - `verifyEmail({ token, now })`: a transaction with `consumeAuthToken`, `markEmailVerified`
    (only while it's null) and `invalidateUserTokens(email_verification)`.

  Tests: verification sets `email_verified_at`; a used token or an expired one gives a typed error;
  the email is in the requested locale (uk and en).
- [x] **7. Pages.**
  - `forgot-password.tsx`: a logged-in user is redirected to the account. The action parses
    `forgotPasswordSchema` (400 with field errors), checks `passwordResetLimiters`
    (`byEmail.isBlocked(email)` or `byIp.isBlocked(ip)` → 429 `tooManyRequests`), hits both, runs
    `void requestPasswordReset(…)` and returns `{ sent: true }`. The page then shows "If this email
    is registered, we've sent a link" with the email cleared.
  - `reset-password.tsx`: the loader parses `params.token` with `authTokenSchema` (a bad token is
    shown as `unknown`) and runs `inspectResetToken`. It renders the error panel with a link to
    `forgotPassword`, or the form (new password and confirmation, `autoComplete="new-password"`).
    The action re-parses the token, validates `resetPasswordSchema`, then calls `resetPassword`.
    On success it runs `touchLastLogin`, `loginLimiters.byEmail.reset`,
    `onUserAuthenticated(…, "password_reset")` and
    `createUserSession({ authenticatedAt: now, redirectTo: account })`. A token error re-renders
    the error panel.
  - `verify-email.tsx`: the loader inspects the token. The page shows a "Confirm my email" form
    (Q4); the action runs `verifyEmail` and shows success with a link to the account (or to login
    when logged out).

  The reset and verify pages get `headers()` → `Referrer-Policy: no-referrer`,
  `Cache-Control: no-store`. All three use `noindexMeta`. `AuthLayout` gets a variant without the
  login/register tabs, following the C+ tokens in `docs/design.md`.
- [x] **8. Wire the entry points.**
  - `login.tsx`: a "Forgot password?" link (`pathFor(locale, "forgotPassword")`) under the
    password field.
  - `register.tsx`: after `registerUser` succeeds, runs `void sendVerificationEmail(…)`.
  - `account._index.tsx`: the loader returns `emailVerified`; `VerifyEmailBanner` shows while it's
    false; the action (`intent=resend-verification`, zod-validated) checks
    `verificationEmailLimiter` by user id and returns `{ resent: true }` or `tooManyRequests`.
  - `account.profile.tsx`: Q2 (after `changePassword`, set `password_changed_at` and re-commit the
    session with the same `authenticatedAt`) and Q5 (an email change clears `email_verified_at`
    and sends verification to the new address).

  Route tests cover each change.
- [x] **9. Translations.** Add every key to `uk.ts` (the source of truth) and `en.ts`: page
  titles, form labels, the generic answer, token errors, the banner, the resend confirmations,
  `auth.errors.tooManyRequests` and the two emails' subject and body. `pnpm typecheck` catches a
  missing key. Component tests render Ukrainian, plus one `<I18nProvider locale="en">` case per
  page.
- [ ] **10. Docs.** Update `app/.server/AGENTS.md`:
  - a new "Password reset and email verification" section (tokens, hashing, lifetimes, single use,
    limits, the revocation check, best-effort delivery);
  - fix the Profile line about sessions not being revoked;
  - mention `users.email_verified_at` and `users.password_changed_at` in the DB section.

  Then run the full suite.

## Testing & verification

- Unit: token generation and hashing; `isSessionRevoked`; the zod schemas (token format, password
  rules, mismatch); the limiters (3 per email, 10 per IP, 3 per user per hour, with an injected
  clock); the email builders (uk and en, absolute link from `PUBLIC_SITE_URL`, raw token never
  stored).
- DB integration (`describe.skipIf(!hasDatabase)`, `createTestDatabase()`):
  - consume once, expiry and the concurrent consume;
  - the reset sets the hash and `password_changed_at` and invalidates sibling tokens;
  - verification sets `email_verified_at`;
  - a migration up/down round trip.
- Route tests:
  - forgot-password gives an identical response body and status for a registered and an unknown
    email, and 429 after the limit;
  - reset logs in (there's a `Set-Cookie`) and an older cookie is then rejected by `getUser`;
  - register calls the verification sender;
  - the account banner and resend, including the limit.
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Manual (`pnpm aspire run`, smtp4dev UI):
  1. Register, then receive the verification email (uk), confirm, and the banner disappears.
  2. Log in in two browsers, then do a forgot password → reset in one. The other browser is
     logged out, and the link fails the second time.
  3. Repeat in `/en/`.
  4. Submit an unknown email and see the same answer.
  5. Submit the form 4 times and get the rate-limit message.

## Acceptance criteria

- [ ] "Forgot password?" sends a reset link valid for 1 hour, and the link works only once: steps
  2, 5, 7, 8
- [ ] The form gives the same answer whether or not the email is registered: steps 5, 7
- [ ] After a reset the user is logged in, and their other sessions are logged out: steps 3, 7
- [ ] New accounts get a verification email, and the account page offers to resend it until it's
  confirmed: steps 6, 8
- [ ] Tokens are stored only as hashes, and the requests are rate-limited: steps 2, 4, 7, 8
- [ ] All pages and emails work in Ukrainian and English: steps 4, 7, 9
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass: step 10

## Out of scope

- Social login, two-factor authentication, and changing the email flow itself (only the
  verification reset in Q5).
- Requiring verification to log in or order, and forcing existing users to verify.
- The branded HTML email layout and the production SMTP provider (#134).
- An outbox or retries for auth emails, and a job that cleans up expired `auth_tokens` rows (the
  table stays small; a cleanup can come with the ML/ops jobs later).
- A shared rate-limit store for running several instances (the per-process limiters, as today).
