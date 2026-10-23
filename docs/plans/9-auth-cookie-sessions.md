# Plan: Implement registration, login and logout with cookie sessions (#9)

Issue: https://github.com/savchukolgaa/jassmin/issues/9
Branch: `issue/9`
Worktree: `../jassmin-worktrees/issue-9`
Status: Planned

## Goal
Customers can create an account, log in and log out so they can track orders and check out faster.
`/register`, `/login` and `/logout` work as route `action`s on top of the existing cookie session
storage. A `requireUser` helper protects routes and sends visitors to `/login?redirectTo=…`, then
back to that page after login. Every successful login updates `users.last_login_at`, a churn-model
feature.

## Dependencies & prerequisites
- **#3 (closed, merged):** the `users` table exists in `app/.server/db/schema.ts` with `fullName`,
  `email` (unique), `passwordHash`, `phone`, `acquisitionChannel` (default `'direct'`) and
  `lastLoginAt`. No migration is needed.
- **Session storage already exists:** `app/.server/session.ts` (`__jassmin_session`, httpOnly,
  sameSite lax, secure in production, signed with `SESSION_SECRET`, `SessionData.userId`). This
  issue builds on it and doesn't create a new one.
- **#18 (open) and #5 (open), analytics:** the `sessions` and `user_events` tables and
  `trackEvent` / `linkVisitorToUser` don't exist yet. This issue **can't** record the `login`
  event or link anonymous events. It leaves one clearly marked hook (`onUserAuthenticated`, step 5)
  that #18 fills in.
- **#10 (open), cart:** `mergeGuestCart` doesn't exist yet. #10 calls it from the same hook.
- **#27 (open), C+ design:** the forms follow the "C+ Sign in / Sign up" canvas page
  (https://claude.ai/artifact/RCvne95y2han2bw8dWm1iW). If #27 hasn't merged yet, use the existing
  `Button` and theme tokens. The C+ colours then arrive through `--color-primary` without changes
  here.
- **New package:** `@node-rs/argon2` for password hashing. It ships prebuilt binaries (Windows
  included) and has no install script.
- No new env vars: `SESSION_SECRET` is already validated (min 32 characters) in `app/.server/env.ts`.

## Decisions & assumptions
- **Hashing with argon2id** (`@node-rs/argon2`, library defaults) rather than bcrypt. Argon2id is
  the current OWASP recommendation, it has no 72-byte password limit and needs no native build
  step. It's wrapped in `app/.server/password.ts` (`hashPassword`, `verifyPassword`), so the
  library can be swapped in one place. (confirmed, Q1)
- **Module layout** follows `app/.server/AGENTS.md`:
  - `session.ts`: cookie-only helpers (`getUserId`, `createUserSession`, `logout`). The issue
    names these.
  - `db/queries/users.ts`: small typed queries that take a `Db`, like `seedProducts(db)`.
  - `services/auth.ts`: `getUser`, `requireUser`, `registerUser`, `verifyLogin`. These need the DB,
    which is why they're in `services/` instead of `session.ts`.
  - `app/lib/auth.ts`: isomorphic zod schemas, the `AuthFormErrors` type and `safeRedirect`.
  - `app/features/auth/`: the form UI.
- **Emails are normalised** (trimmed and lowercased) before every lookup and insert. The DB unique
  constraint is case-sensitive, so this keeps `A@x.com` and `a@x.com` from becoming two accounts.
- **Duplicate emails:** registration checks first and returns a field error. It also catches
  PostgreSQL `23505` on insert, for the case where two sign-ups race, and returns the same error.
- **Generic login error:** "Incorrect email or password" for both an unknown email and a wrong
  password. When the email is unknown, the action still verifies against a fixed dummy hash, so
  the response time doesn't reveal whether an account exists.
- **Registration logs the user in** and also sets `last_login_at = now()`. A brand-new customer
  then has a non-null recency value for the churn model. (confirmed, Q3)
- **`acquisition_channel`:** the `/register` loader works it out from `utm_source` in the URL,
  otherwise from an external `Referer` host (without `www.`), otherwise `'direct'`. It sends the
  value through a hidden form field, which the action validates (max 100 characters, lowercased).
  Doing this in the loader matters because when the form is posted, `Referer` is our own
  `/register` page. When #18 adds analytics sessions, the session's `traffic_source` should take
  over. (confirmed, Q2)
- **Rate limiting** is an in-memory fixed window in `app/.server/rate-limit.ts`: at most 5 failed
  logins per normalised email and 20 per client IP in 15 minutes. The IP comes from the first
  `X-Forwarded-For` entry and the limit is skipped when there's none. Over the limit, the action
  returns a typed error with HTTP 429, and a successful login clears the email's counter. A single
  Node process is enough for a small shop. (confirmed, Q4)
- **Open-redirect protection:** `safeRedirect(to, fallback = "/account")` only accepts paths that
  start with a single `/` (not `//`, not `/\`).
- **`/logout` is an action-only resource route** (`routes/logout.ts`), registered **outside** the
  `_shop` layout so the layout loader doesn't run for it. Its `loader` redirects GET requests to
  `/`, so a link or a prefetch can never log anyone out. The logout button is a
  `<Form method="post" action="/logout">` on the account page. The header only has a profile
  icon, and a header/menu logout is left to #27/#12.
- **`/account` becomes protected** (`requireUser` in its loader). `/checkout` stays open, because
  guest checkout is #11's decision.
- **The header uses the real user:** `getHeaderState` calls `getUser(request)`, so a cookie for a
  deleted user renders as logged out. `HeaderUser` stays `{ id }`; #27/#12 can add `fullName`
  when the design needs it.
- **Logged-in users on `/login` or `/register`** are redirected to `safeRedirect(redirectTo)` by
  the loaders.
- **Deviation: `registerUser` doesn't use a transaction.** It's a single `INSERT` that sets
  `last_login_at` too, so a transaction adds nothing.
- **Deviation: `vitest.config.ts` `testTimeout: 20_000`.** On this machine, the first dynamic
  import of the server modules takes over 5s, so `health.test.ts` and `header.test.ts` already
  timed out on `main`, and the new auth tests did too.
- **Forms work without JS:** plain `<Form method="post">`, errors from `actionData`, submitted
  values (except passwords) echoed back as `defaultValue`, and `redirectTo` carried in a hidden
  input. `useNavigation` shows the `Button`'s `loading` state when JS is available.

## Resolved questions
- **Q1: argon2id or bcrypt?** — argon2id via `@node-rs/argon2` (answered by the user, 2026-10-23).
- **Q2: What does `acquisition_channel` contain?** — The default: lowercased `utm_source`, else
  the external referrer host, else `'direct'` (answered by the user).
- **Q3: Does registration also set `last_login_at`?** — Yes (answered by the user).
- **Q4: Is an in-memory limiter enough?** — Yes (answered by the user).
- **Q5: Which language for the auth copy?** — English for now, with the strings kept in
  `app/features/auth/` for easy translation. Multi-language support is tracked in #28 (answered by
  the user).
- **Is a new session storage needed?** — No. `createCookieSessionStorage` with exactly the
  required cookie options and `SessionData.userId` already exists (source:
  `app/.server/session.ts`, `app/.server/AGENTS.md` → "Session").
- **Does the `users` table need changes?** — No. All columns exist and `acquisition_channel`
  defaults to `'direct'` (source: `app/.server/db/schema.ts`, #3).
- **Where do `/login` and `/register` live?** — They're already registered under the `_shop`
  layout as placeholders (source: `app/routes.ts`, `app/routes/login.tsx`,
  `app/routes/register.tsx`).
- **How does the header learn the login state on first render?** — The `_shop` layout loader runs
  `getHeaderState(request)` on the server for every request and after every action. It currently
  trusts `session.userId` as a stub "until #9" (source: `app/routes/_shop.tsx`,
  `app/.server/services/header.ts`).
- **Should query functions use the `db` singleton or take a `Db`?** — Take a `Db` (or a
  transaction), so integration tests can run on a throwaway DB from `createTestDatabase()`.
  Routes pass `db` (source: `app/.server/db/seed.ts`, `app/.server/db/test-utils.ts`).
- **Can the `login` event and anonymous-event linking be done now?** — No. The analytics tables
  are #5 and the tracking API is #18, both open. Only a hook is left (source: #5, #18).
- **Who merges the guest cart on login?** — #10 (`mergeGuestCart`, "Call `mergeGuestCart` from
  the login/register actions"). This issue only provides the hook (source: #10).
- **Which pages need protecting now?** — `/account` (#12: "Logged-out users are redirected to
  login"). Admin protection is #14 (source: #12).
- **Which design should the forms follow?** — The "C+ Sign in / Sign up" canvas page (source: #27).

## Files
| Action | Path | Purpose |
|--------|------|---------|
| modify | `package.json`, `pnpm-lock.yaml` | Add `@node-rs/argon2` |
| create | `app/.server/password.ts` (+ `.test.ts`) | `hashPassword`, `verifyPassword`, `getDummyPasswordHash` |
| create | `app/.server/rate-limit.ts` (+ `.test.ts`) | In-memory fixed-window limiter, `getClientIp` |
| modify | `app/.server/session.ts` (+ new `session.test.ts`) | `getUserId`, `createUserSession`, `logout` |
| create | `app/.server/db/queries/users.ts` (+ `.test.ts`) | `findUserByEmail`, `findUserById`, `insertUser`, `touchLastLogin` |
| create | `app/.server/db/errors.ts` | `pgErrorCode`, `UNIQUE_VIOLATION` (shared with `test-utils.ts`) |
| modify | `vitest.config.ts` | Raise `testTimeout` to 20s |
| create | `app/.server/services/auth.ts` (+ `.test.ts`) | `getUser`, `requireUser`, `registerUser`, `verifyLogin`, `onUserAuthenticated` |
| modify | `app/.server/services/header.ts` (+ `.test.ts`) | Use `getUser` instead of the session stub |
| create | `app/lib/auth.ts` (+ `.test.ts`) | zod schemas, `AuthFormErrors`, `safeRedirect`, `resolveAcquisitionChannel` |
| create | `app/features/auth/AuthForm.tsx`, `TextField.tsx` | Shared form layout and field with error |
| modify | `app/routes/register.tsx` | loader + action + form |
| modify | `app/routes/login.tsx` | loader + action + form |
| create | `app/routes/logout.ts` | POST-only logout |
| modify | `app/routes/account.tsx` | `requireUser`, logout button |
| modify | `app/routes.ts`, `app/routes.test.ts` | Register `/logout` outside the shop layout |
| modify | `app/.server/AGENTS.md` | Document the auth helpers |

## Steps
Each step is small, ordered, and leaves the app in a working state.

- [x] **1. Add password hashing.** `pnpm add -w @node-rs/argon2` (`-w` because the repo is a pnpm workspace with `cms`). In `app/.server/password.ts`:
  `hashPassword(plain): Promise<string>` (argon2id, library defaults) and
  `verifyPassword(hash, plain): Promise<boolean>`, which returns `false` instead of throwing for a
  malformed hash. Also export `getDummyPasswordHash()`, which hashes a random password once
  (memoised) for timing-equalised checks, so it always matches the current hash parameters. Tests: a hash doesn't contain the plain password and starts with
  `$argon2id$`; a correct password verifies; a wrong one and garbage input don't.
- [x] **2. Add the user queries.** `app/.server/db/queries/users.ts`, where each function takes
  `db: Db` first:
  - `findUserByEmail(db, email)`: returns `{ id, passwordHash }` or `undefined`.
  - `findUserById(db, id)`: returns `{ id, fullName, email }` (a `PublicUser` type, never the
    hash) or `undefined`.
  - `insertUser(db, values)`: returns `{ id }`.
  - `touchLastLogin(db, id)`: sets `lastLoginAt = sql\`now()\``.

  Add an integration test (`describe.skipIf(!hasDatabase)`, `createTestDatabase("jassmin_users_test")`,
  `migrateLatest`) for insert/find, the `'direct'` default, a duplicate insert giving `23505`
  (via `pgErrorCode`) and `touchLastLogin` changing the timestamp. Emails arrive already
  normalised by the zod schema (step 4), so case handling is tested at the service level (step 5).
- [x] **3. Add the rate limiter.** `app/.server/rate-limit.ts`:
  `createRateLimiter({ limit, windowMs, now? })` returns `{ isBlocked(key), hit(key), reset(key) }`
  over a `Map`, pruning expired entries when it's called. Export a `loginLimiters` singleton (`byEmail`: 5, `byIp`: 20 per 15 min) (kept
  on `globalThis` across HMR, like `db/index.ts`) and `getClientIp(request)`. Unit-test the limit,
  the window expiry (with an injected `now`), `reset` and IP parsing.
- [x] **4. Add the shared auth schemas and helpers.** In `app/lib/auth.ts`:
  - `registerSchema`: `fullName` trimmed, 1–255; `email` trimmed, lowercased, `z.email()`, max
    255; `password` 8–128; `phone` optional, empty string → `undefined`, `/^\+?[0-9 ()-]{7,20}$/`,
    max 50; `acquisitionChannel` optional, lowercased, max 100.
  - `loginSchema`: `email`, `password` (min 1), `redirectTo` optional.
  - `type AuthFormErrors = { fieldErrors?: Partial<Record<…, string>>; formError?: string }`.
  - `safeRedirect(to, fallback = "/account")`.
  - `resolveAcquisitionChannel(url, referer)`: `utm_source`, otherwise the external referrer
    host (compared with `url.host`), otherwise `'direct'`.
  - `toFieldErrors(error, fields)` (first message per field) and `loginRedirectPath(url)`.
  - An invalid `acquisitionChannel` is dropped (`.catch(undefined)`) instead of failing the form.

  Unit-test every rule, including the open-redirect cases (`//evil.com`, `/\evil.com`,
  `https://evil.com`, `undefined`).
- [x] **5. Add the session helpers and the auth service.**
  - `session.ts`: `getUserId(request)`, `createUserSession({ request, userId, redirectTo })`,
    which sets `userId`, commits and returns `redirect(redirectTo, { headers: { "Set-Cookie" } })`,
    and `logout(request)`, which destroys the session and redirects to `/`.
  - `services/auth.ts`:
    - `getUser(request, database = db)`: `findUserById` from the session's `userId`, `null`
      when it's missing or the user doesn't exist.
    - `requireUser(request)`: throws
      `redirect("/login?redirectTo=" + encodeURIComponent(pathname + search))` when there's no
      user.
    - `registerUser(database, input)`: hashes the password and inserts the user with
      `lastLoginAt` set (a single insert, so no transaction is needed); maps `23505` (via the new
      `db/errors.ts` `pgErrorCode`, also reused by `test-utils.ts`) to
      `{ ok: false, error: "email_taken" }`.
    - `verifyLogin(database, email, password)`: verifies against `getDummyPasswordHash()` when the
      email is unknown; on success calls `touchLastLogin`; returns `{ ok: true, userId }` or
      `{ ok: false }`.
    - `onUserAuthenticated(request, userId, kind: "login" | "register")`: a no-op hook with a
      comment saying that #18 adds `linkVisitorToUser` and the `login` event and #10 adds
      `mergeGuestCart`. It must never throw.

  Unit-test the session helpers (the cookie round-trip and `requireUser`'s redirect URL), and add
  DB integration tests for `registerUser` / `verifyLogin`. These check the stored hash ≠ the
  password, a duplicate email, a wrong password, an unknown email and that `last_login_at` moves
  forward on each login.
- [x] **6. Show the real user in the header.** `getHeaderState` calls `getUser(request)`. Update
  `header.test.ts` to `vi.mock("./auth")`, covering "no user → logged out" and "user → `{ id }`".
  Check that the header shows the account icon on the very first SSR response after login.
- [ ] **7. Build `/register`.**
  - `loader`: redirect when already logged in; return
    `{ acquisitionChannel: resolveAcquisitionChannel(...) }`.
  - `action`: `formData` → `registerSchema.safeParse` → return `data(errors, { status: 400 })` on
    failure → `registerUser(db, …)` → `email_taken` → field error → `onUserAuthenticated` →
    `createUserSession({ redirectTo: safeRedirect(redirectTo) })`.
  - UI: `app/features/auth/AuthForm.tsx` (heading, card and footer link) and `TextField.tsx`
    (label, input, `aria-invalid`, `aria-describedby` error text), following the C+ Sign up page.
    Fields: full name, email, password (`autoComplete="new-password"`), optional phone, plus
    hidden `acquisitionChannel` and `redirectTo`. Add a link to `/login` that keeps `redirectTo`.
- [ ] **8. Build `/login`.**
  - `loader`: redirect a logged-in user to `safeRedirect(redirectTo)`; return `redirectTo` for the
    hidden field.
  - `action`: parse with `loginSchema`. If `loginLimiters` block the email or IP, return
    `data({ formError: "Too many attempts…" }, { status: 429 })`. Then `verifyLogin`: on failure,
    `hit` both keys and return the generic error (400) with the email echoed back; on success,
    `reset` the email key, call `onUserAuthenticated(…, "login")` and
    `createUserSession({ redirectTo: safeRedirect(redirectTo) })`.
  - UI: email and password (`autoComplete="current-password"`), and a link to `/register` that
    keeps `redirectTo`.
- [ ] **9. Add `/logout` and protect `/account`.** Add `route("logout", "routes/logout.ts")` in
  `app/routes.ts` next to `admin/*`, outside the layout. `routes/logout.ts`: `action` → `logout(request)`;
  `loader` → `redirect("/")`. `account.tsx` `loader`: `const user = await requireUser(request)`,
  returning `{ fullName }`. The page keeps the placeholder content (the full dashboard is #12),
  adds "Hi, {fullName}" and a `<Form method="post" action="/logout">` with a secondary "Log out"
  button. Update `routes.test.ts` so it expects `/logout` outside the shop layout.
- [ ] **10. Update the docs and do the final checks.** In `app/.server/AGENTS.md`, add an "Auth"
  section covering `requireUser` for protected loaders, never returning `passwordHash`,
  `safeRedirect` for every redirect target, and `onUserAuthenticated` as the place for post-login
  side effects. Run `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build`.

## Testing & verification
- **Unit tests:** `password.test.ts`, `rate-limit.test.ts`, `lib/auth.test.ts`, `session.test.ts`,
  `services/header.test.ts` and `routes.test.ts`.
- **DB integration tests** (skipped without a DB, using a throwaway DB): `queries/users.test.ts`
  and `services/auth.test.ts`.
- **Commands:** `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` must all pass.
- **Manual checks** (`pnpm aspire run`), done once with JS disabled in DevTools and once with it
  enabled:
  1. Register a user. You're redirected to `/account`, the header shows the account icon on first
     paint, and `select password_hash, last_login_at, acquisition_channel from users` shows an
     `$argon2id$` hash and a timestamp.
  2. Open `/register?utm_source=instagram` and register. The channel is `instagram`.
  3. Register the same email again in different case. You get the "already registered" error.
  4. Log out, which redirects to `/` and shows the header as logged out. A `GET /logout` does
     nothing harmful.
  5. Visit `/account`. You're redirected to `/login?redirectTo=%2Faccount`, logging in returns you
     to `/account`, and `last_login_at` changes.
  6. A wrong password and an unknown email both show the same message. On the 6th failed attempt
     you get the "too many attempts" message.
  7. `/login?redirectTo=//evil.com` lands you on `/account` after login.
  8. While logged in, visiting `/login` or `/register` redirects away.

## Acceptance criteria
- [ ] Users can register, log in and log out (forms work without client JS) — steps 5, 7, 8, 9
- [ ] Passwords are never stored or returned in plain text — steps 1, 2 (`PublicUser` without the hash), 5, 7, 8 (passwords never echoed back)
- [ ] `last_login_at` updates on each successful login — steps 2, 5, 8
- [ ] Protected routes redirect to `/login` and return to the original page after login — steps 4 (`safeRedirect`), 5 (`requireUser`), 8, 9
- [ ] Header reflects logged-in state on first render — step 6

## Out of scope
- Recording the `login` event and linking anonymous sessions and events (#18, after #5). Only the
  `onUserAuthenticated` hook is added.
- Merging the guest cart on login (#10).
- The account dashboard and orders (#12), and admin auth and roles (#14).
- Password reset, email verification, "remember me", OAuth and CSRF tokens. SameSite=lax plus
  POST-only mutations cover the basic CSRF risk.
- A distributed or persistent rate limiter (Q4: in-memory is enough).
- Translating the auth forms (#28).
- C+ header changes such as the white profile circle (#27).
