# Plan: Add account profile page to edit contact details and password (#54)

Issue: https://github.com/savchukolgaa/jassmin/issues/54
Branch: `issue/54`
Worktree: `.claude/worktrees/issue-54`
Status: Planned

## Goal
A logged-in customer can open "Profile details" in the account area and change their name and
phone, their email and their password. The checkout prefill then shows the current details, and
the account stays secure because email and password changes need the current password. Work
starts with a C+ design mockup, then `/account/profile` gets three no-JS forms that are validated
with zod and saved in the route `action`.

## Dependencies & prerequisites
- **#12 (merged, `4a262dc`)**: `routes/account.tsx` layout with the `NAV` side menu, `requireUser`
  in every child loader, `noindex` meta and `Cache-Control: private, no-store` headers.
- **#9 (merged)**: `registerSchema` / `emailSchema` in `app/lib/auth.ts`, `hashPassword` /
  `verifyPassword` (argon2id) in `app/.server/password.ts`, `pgErrorCode` / `UNIQUE_VIOLATION` in
  `app/.server/db/errors.ts`, and `createRateLimiter` in `app/.server/rate-limit.ts`.
- **#11 (merged)**: checkout prefill reads `findUserContact` (`db/queries/users.ts`) on each
  request, so updated contact details reach the checkout with no extra work.
- No new packages, env vars or migrations: `users.full_name`, `phone`, `email` and
  `password_hash` already exist. The schema has no `users.updated_at`, and this plan doesn't add
  one.
- Design canvas: https://claude.ai/artifact/RCvne95y2han2bw8dWm1iW, a "Design" canvas owned by
  this account (access checked on 2026-10-25). Its artboards are `project/<Name>.dc.html` files
  listed in `project/canvas.json`, and the account page is `project/AccountPlus.dc.html`.
- The email-change notice (Q3) uses the existing mail setup: `getMailTransport()` and
  `stripLineBreaks` in `app/.server/mail.ts`, and `CONTACT_FROM` from `getEnv()`. Locally it lands
  in smtp4dev under Aspire, and without `SMTP_URL` it's skipped.

## Decisions & assumptions
- **Service location:** a new `app/.server/services/profile.ts` holds `getProfile`,
  `updateContact`, `changeEmail` and `changePassword`. This keeps `auth.ts` about login and
  session concerns. Its queries go in `db/queries/users.ts`.
- **Password hash access:** add `findUserCredentialsById(db, id)` next to `findUserByEmail`. It
  is the only new query that selects `password_hash`, and only the profile service uses it. The
  rule in `app/.server/AGENTS.md` gets updated to list it.
- **Schemas:** split the field rules out of `registerSchema` into exported `fullNameSchema`,
  `phoneSchema` (optional; blank becomes `undefined`) and `newPasswordSchema` (8–128), and build
  `registerSchema` from them so nothing changes for registration. New schemas:
  - `contactSchema = { fullName, phone }`
  - `changeEmailSchema = { email: emailSchema, currentPassword }`
  - `changePasswordSchema = { currentPassword, newPassword: newPasswordSchema,
    confirmNewPassword }`, with a `.refine` that puts
    `account.profile.errors.passwordMismatch` on `confirmNewPassword` when the two differ (Q2)
  - `currentPassword` is `z.string().min(1, msg("account.profile.errors.currentPasswordRequired"))`
  - `profileIntentSchema = z.enum(["contact", "email", "password"])`
- **Error keys:** shared field rules keep their existing `auth.errors.*` keys (`nameRequired`,
  `phoneInvalid`, `emailInvalid`, `emailTaken`, `passwordTooShort`, …), so the two flows can't
  drift apart. New keys go in `account.profile.errors.*`: `currentPasswordRequired`,
  `currentPasswordWrong`, `passwordMismatch`, `tooManyAttempts` and `invalidIntent`.
- **Clearing the phone:** a blank phone stores `NULL`, because phone is optional at registration
  too (Q1, confirmed).
- **Action result shape:** `ProfileActionData` in `~/lib/auth` (isomorphic) is either
  `{ ok: true; intent }` or
  `{ ok: false; intent; fieldErrors?; formError?; values? }`, where `values` never includes a
  password. Errors are returned with `data(…, { status: 400 | 429 })`. Each panel shows errors and
  the success message only when `actionData.intent` matches its own intent.
- **Same field name in two forms:** both the email and the password panels need a
  `currentPassword` input, and `TextField` derives `id="field-${name}"`. Add an optional `id`
  prop to `TextField` (default unchanged) and pass `field-email-currentPassword` /
  `field-password-currentPassword`, so ids stay unique and labels stay associated.
- **Rate limit:** add `profilePasswordLimiter` to `rate-limit.ts`, keyed by user id: 5 wrong
  current passwords per 15 minutes, shared by the email and password intents, kept on
  `globalThis` like `loginLimiters`. While blocked, the action returns 429 with
  `account.profile.errors.tooManyAttempts` before it verifies anything. A wrong password counts a
  hit, and a correct one resets the counter. There's no per-IP limiter, because the user is
  already authenticated.
- **Email change:** `changeEmail(db, userId, currentPassword, newEmail)` returns
  `{ ok: true } | { ok: false; error: "wrong-password" | "email-taken" }`. It verifies the
  password first, then updates. A `23505` from the update becomes `email-taken`, with no
  pre-check, so a race can't slip past. Setting the same email again is a harmless no-op success.
  The session holds only `userId`, so it stays valid. On a real change, the success result
  carries `previousEmail`.
- **Email-change notice (Q3, confirmed):** after a successful change to a different address, the
  action calls `void notifyEmailChanged({ to: previousEmail, newEmail, fullName, locale })`. It
  sends a plain-text email to the **old** address: the account's email was changed to
  `<new email>` at `<time>`, and if it wasn't you, contact the store. The copy comes from the
  `account.profile.emailChangedMail` keys in the request's locale (`getLocale(request)`), and the
  sender is `CONTACT_FROM`.
  - It's built by `buildEmailChangedNotice(…)`, a pure function that is tested, and the name goes
    through `stripLineBreaks`.
  - The mailer is injectable (`MailSender | null`, as in `services/contact.ts`). Without
    `SMTP_URL` it's skipped.
  - It never throws: errors are logged, and the email change still succeeds when the mail fails.
  - There's no outbox or retry like `order_emails`. A lost notice is acceptable here, and the
    schema stays untouched.
- **Password change:** `changePassword(db, userId, currentPassword, newPassword)` returns
  `{ ok: true } | { ok: false; error: "wrong-password" }` and stores only
  `await hashPassword(newPassword)`. The form has a "Confirm new password" field, checked by zod
  before any DB call (Q2, confirmed). The current session stays logged in, and other devices
  aren't signed out (issue assumption).
- **Contact update:** `updateContact(db, userId, { fullName, phone })` needs no password. The
  layout's greeting refreshes automatically because React Router revalidates loaders after an
  action.
- **Loader:** `requireUser`, then `getProfile(user.id)` → `{ fullName, email, phone, createdAt }`
  through a new `findUserProfile` query, which never selects the hash. The route also exports its
  own `meta` (`noindex` plus a title) and `headers` (`private, no-store`), because a child route's
  `meta` replaces the layout's.
- **UI:** the page has three white `rounded-card` panels (Contact details, Email, Password), each
  a `<Form method="post" noValidate>` with a hidden `intent`. Its submit `Button` has
  `loading={submitting}`, where `submitting` is `navigation.state === "submitting"` **and**
  `navigation.formData?.get("intent")` is that panel's intent, so only the panel being sent is
  disabled. On success, a `role="status"` message shows in the panel and the password fields are
  empty, because they never get a `defaultValue`. The password form also has a hidden
  `autoComplete="username"` email input, so password managers update the right entry. The panels
  live in `app/features/account/ProfileForms.tsx`, so component tests can render them without the
  route. "Member since {date}" uses `formatDate`.
- **Phone-width mockup (deviation, step 1):** an artboard has one frame size, so the
  phone-width layout is a second artboard, `AccountProfilePlusPhone.dc.html` (390 px, errors on),
  next to the desktop one. Both have `showErrors` / `showSaved` toggles.
- **Side menu:** insert `{ to: "/account/profile", labelKey: "account.nav.profile" }` after
  Orders. The Orders link (`/account`) needs `end: true`, otherwise it would stay active on
  `/account/profile`. It's also active on `/account/orders/:id` today, so check that change
  doesn't lose the active state there. If it does, use a custom `isActive` for Orders that matches
  `/account` and `/account/orders/*`.

## Resolved questions
- **Q1: Can customers clear their phone number?** Yes. A blank phone saves as `NULL` (answered
  by the user, 2026-10-25).
- **Q2: Does the password form have a "Confirm new password" field?** Yes, with a
  `passwordMismatch` field error (answered by the user, 2026-10-25).
- **Q3: Does the old address get a notice when the email changes?** Yes, a plain-text notice to
  the previous email, sent without failing the change (answered by the user, 2026-10-25).
- **Q4: Who updates the design canvas?** `/implement` does: the canvas is owned by this account,
  and reading it and listing its files works (checked on 2026-10-25). Add the artboard as
  `project/AccountProfilePlus.dc.html` and update `project/canvas.json`.
- **Does the checkout prefill need changes?** No. `getCheckoutPrefill` calls
  `findUserContact` on every checkout load, so new values show up right away (source:
  `app/.server/services/orders.ts:46`, `app/.server/db/queries/users.ts:51`).
- **Does changing the email invalidate the session?** No. The session cookie stores only
  `userId`, and `requireUser` reloads the user from the DB on every request (source:
  `app/.server/session.ts`, `app/.server/services/auth.ts` `getUser`).
- **How are unique-email races detected?** `pgErrorCode(error) === UNIQUE_VIOLATION`, as in
  `registerUser` (source: `app/.server/services/auth.ts`, `app/.server/db/errors.ts`).
- **Which validation rules are reused?** The name, phone, email and password rules from
  `registerSchema` and `emailSchema` (source: `app/lib/auth.ts`; issue #54 Technical).
- **How do account routes protect themselves?** Each child loader and action calls `requireUser`
  itself, because loaders run in parallel (source: `app/routes.ts` comment,
  `app/routes/account._index.tsx`).
- **How are field errors converted?** `toFieldErrors(parsed.error, FIELDS)` turns them into
  `TextKey`s, and unknown messages become `errors.invalid` (source: `app/lib/auth.ts`).
- **Should account deletion, email verification, password reset, saved addresses or marketing
  preferences be included?** No, all of them are out of scope (source: issue #54).
- **Should other sessions be revoked after a password change?** No: there's no server-side
  session store (source: issue #54 assumptions).

## Files
| Action | Path | Purpose |
|--------|------|---------|
| modify | `docs/design.md` | Add `C+ Account profile` row (`/account/profile`, #54) to "Pages and issues" |
| create | canvas `project/AccountProfilePlus.dc.html` | `C+ Account profile` artboard |
| create | canvas `project/AccountProfilePlusPhone.dc.html` | Phone-width variant (390 px) with the field errors on |
| modify | canvas `project/canvas.json` | Board entry next to `AccountPlus.dc.html`, plus its `order` slot |
| modify | `app/lib/auth.ts` | Extract field schemas; add `contactSchema`, `changeEmailSchema`, `changePasswordSchema`, `profileIntentSchema`, field types and `ProfileActionData` |
| modify | `app/lib/auth.test.ts` | Tests for the new schemas; register schema unchanged |
| modify | `app/.server/db/queries/users.ts` | `findUserProfile`, `findUserCredentialsById`, `updateUserContact`, `updateUserEmail`, `updateUserPasswordHash` |
| modify | `app/.server/db/queries/users.test.ts` | Integration tests for the new queries |
| create | `app/.server/services/profile.ts` | `getProfile`, `updateContact`, `changeEmail`, `changePassword`, `buildEmailChangedNotice`, `notifyEmailChanged` |
| create | `app/.server/services/profile.test.ts` | DB integration tests with `createTestDatabase()` |
| modify | `app/.server/rate-limit.ts` | `profilePasswordLimiter` |
| modify | `app/components/ui/TextField.tsx` | Optional `id` override |
| create | `app/features/account/ProfileForms.tsx` | `ContactPanel`, `EmailPanel`, `PasswordPanel` |
| create | `app/features/account/profile-ui.test.ts` | Component tests in uk/en |
| create | `app/routes/account.profile.tsx` | Loader, action, meta, headers, page |
| create | `app/routes/account.profile.test.ts` | Loader/action tests with mocked services |
| modify | `app/routes.ts` | `route("profile", "routes/account.profile.tsx")` under `account` |
| modify | `app/routes/account.tsx` | "Profile details" `NavLink`; Orders active state |
| modify | `app/lib/i18n/uk.ts`, `app/lib/i18n/en.ts` | `account.nav.profile` and the `account.profile` namespace |
| modify | `app/.server/AGENTS.md` | Profile service and `findUserCredentialsById` in the password-hash rule |

## Steps
Each step is small, ordered, and leaves the app in a working state.

- [x] **1. Design mockup.** Read `project/canvas.json` and `project/AccountPlus.dc.html` from the
  canvas. Create `project/AccountProfilePlus.dc.html` (title `C+ Account profile`) from a copy of
  `AccountPlus`, then add its board entry to the index next to `AccountPlus`, 80 px to the right
  in the same row, and its `order` slot. It reuses the hero band and side menu, with "Profile
  details" active (`bg-ink text-white` pill). Then three white `rounded-card` panels:
  - Contact details: full name, phone (optional)
  - Email: new email, current password
  - Password: current password, new password with hint, confirm new password

  Show one field-error state (red-700 border and message), one success status line, primary
  `Button`s, the `onLight` focus ring, and a phone-width variant where the menu wraps above
  stacked panels. Use only existing tokens. Publish both files in one call to the canvas URL, and
  add the row to the "Pages and issues" table in `docs/design.md`.
- [ ] **2. Schemas.** In `app/lib/auth.ts`:
  - Extract `fullNameSchema`, `phoneSchema` and `newPasswordSchema`, and rebuild
    `registerSchema` from them.
  - Add `contactSchema`, `changeEmailSchema`, `changePasswordSchema`, `profileIntentSchema`,
    `ContactField` / `ChangeEmailField` / `ChangePasswordField` and `ProfileActionData`.
  - Tests in `auth.test.ts`: the email is trimmed and lowercased, a blank phone becomes
    `undefined`, a bad phone gives `auth.errors.phoneInvalid`, a short new password gives
    `passwordTooShort`, a missing current password gives `currentPasswordRequired`, a different
    confirmation gives `passwordMismatch` on `confirmNewPassword`, and the existing register tests
    still pass.
- [ ] **3. Queries.** In `db/queries/users.ts`:
  - `findUserProfile(db, id)` → `{ fullName, email, phone, createdAt }`
  - `findUserCredentialsById(db, id)` → `UserCredentials`
  - `updateUserContact(db, id, { fullName, phone: string | null })`
  - `updateUserEmail(db, id, email)`, which rejects with `23505` when the email is taken
  - `updateUserPasswordHash(db, id, hash)`

  Extend `users.test.ts`.
- [ ] **4. Profile service and limiter.** Write `services/profile.ts` with the result types from
  Decisions. Each service function takes `database: Db = db`, as `getUser` does. `changeEmail`
  and `changePassword` use `findUserCredentialsById` and `verifyPassword`. Add
  `profilePasswordLimiter` to `rate-limit.ts`. Tests in `profile.test.ts` (`describe.skipIf`,
  `createTestDatabase`):
  - The contact update shows up in `findUserContact` (the checkout prefill), and a blank phone
    stores `NULL`.
  - A wrong password changes nothing for either intent.
  - A taken email gives `email-taken`, and a mixed-case email is stored lowercased.
  - After a password change the stored hash starts with `$argon2id$`, `verifyLogin` succeeds with
    the new password and fails with the old one, and nothing returned contains `passwordHash`.
  - `changeEmail` returns `previousEmail`.
  - Unit tests (no DB) for the notice: `buildEmailChangedNotice` in uk and en (to the old
    address, from `CONTACT_FROM`, mentions the new address, name without line breaks).
    `notifyEmailChanged` sends through a fake `MailSender`, does nothing with `mailer: null`, and
    resolves (logging the error) when `sendMail` rejects.
- [ ] **5. i18n.** Add `account.nav.profile` ("Дані профілю" / "Profile details") and the
  `account.profile` keys in uk and en:
  - `title`, `memberSince`, `submitting`, `invalidIntent`
  - `contact.{heading, submit, saved}`
  - `email.{heading, newEmail, submit, saved}`
  - `password.{heading, current, new, confirm, hint, submit, saved}`
  - `errors.{currentPasswordRequired, currentPasswordWrong, passwordMismatch, tooManyAttempts}`
  - `emailChangedMail.{subject, greeting, body, notYou, signature}`, where `body` has
    `{newEmail}` and `{date}`
- [ ] **6. UI components.** Add the `id` override to `TextField`. Write
  `features/account/ProfileForms.tsx`: each panel takes `profile`, `actionData` (only when its
  intent matches) and `submitting`. Field names and autocomplete:
  - contact: `fullName` (`name`), `phone` (`tel`)
  - email: `email` (`email`), `currentPassword` (`current-password`)
  - password: hidden `username`, `currentPassword` (`current-password`), `newPassword`
    (`new-password`), `confirmNewPassword` (`new-password`)

  `formError` uses `FormAlert` from `features/auth/AuthLayout`. Component tests in
  `profile-ui.test.ts`:
  - Ukrainian labels by default and English inside `<I18nProvider locale="en">`
  - Field errors are rendered with `aria-invalid` and `aria-describedby`
  - The success status appears only in the matching panel
  - Password inputs never get a value
  - Every form is `method="post"` with a hidden `intent`
- [ ] **7. Route.** Write `routes/account.profile.tsx`:
  - `meta` (title `account.profile.title` plus `noindex`) and `headers` (`private, no-store`).
  - The loader calls `requireUser` and returns `getProfile`.
  - The action calls `requireUser`, reads `formData`, and returns 400 `invalidIntent` when
    `intent` isn't valid. `contact` → `contactSchema` → `updateContact`. `email` / `password`:
    check `profilePasswordLimiter.isBlocked(String(user.id))` first (→ 429), parse, call the
    service, then `hit` on `wrong-password` (→ `currentPassword` field error
    `currentPasswordWrong`) or `reset` on success. `email-taken` → `email` field error
    `auth.errors.emailTaken`. Return `{ ok: true, intent }` on success.
  - When the email really changed, call
    `void notifyEmailChanged({ to: previousEmail, newEmail, fullName: user.fullName,
    locale: await getLocale(request) })`.

  Register the route in `app/routes.ts` and add the `NavLink` in `account.tsx` (with the Orders
  active-state fix). Run `pnpm typecheck`.
- [ ] **8. Route tests.** In `account.profile.test.ts` (mocking `~/.server/services/auth` and
  `~/.server/services/profile`, like `account._index.test.ts`), cover:
  - The loader returns the profile, and a logged-out loader or action → 302 to `/login`.
  - `contact` success and a validation error with `values` refilled.
  - `email`: success sends the notice to the old address, while the same email sends none. Also
    wrong password (limiter hit, no notice), taken email and a blocked limiter (429, with no
    service call).
  - `password`: mismatched confirmation → field error with no service call.
  - `password`: success and wrong password; no response contains a password.
  - An unknown intent → 400.
  - `meta` and `headers`.
- [ ] **9. Docs and verification.** Update `app/.server/AGENTS.md`: the password-hash rule now
  includes `findUserCredentialsById`, plus a short "Profile (#54)" note on the service, the
  limiter, the email-taken handling and the email-change notice (best effort, no outbox). Run `pnpm typecheck`, `pnpm lint`, `pnpm test` and
  `pnpm build`, and do the manual checks below.

## Testing & verification
- Automated: schema unit tests (step 2), query and service integration tests against a throwaway
  DB (steps 3–4), component tests in uk/en (step 6), and route loader/action tests (step 8).
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Manual (`pnpm aspire run`):
  - Logged out, `/account/profile` → `/login?redirectTo=%2Faccount%2Fprofile`.
  - Change the name and phone, then check that the hero greeting updates and `/checkout` is
    prefilled with the new values.
  - Change the email with a wrong password (field error), then with a taken email (field error),
    then a valid change. smtp4dev shows the notice sent to the old address. Log out and log in
    with the new email.
  - Change the password with a mismatched confirmation (field error), then validly, then log in
    with the new one; the old one fails.
  - Six wrong current passwords → "too many attempts".
  - Repeat with JavaScript disabled, at phone width and in English.

## Acceptance criteria
- [ ] A C+ design mockup of the profile page is on the design canvas and listed in
  `docs/design.md` — step 1
- [ ] `/account/profile` is reachable from the account side menu and redirects logged-out users
  to `/login` — steps 7, 8
- [ ] Users can update their full name and phone; the checkout prefill shows the new values —
  steps 3, 4, 7
- [ ] Changing the email requires the current password, and a taken email gives a field error —
  steps 4, 7, 8
- [ ] Changing the password requires the current password; the new password is stored only as an
  argon2id hash — steps 4, 7, 8
- [ ] All inputs are validated with zod and errors show next to the fields, in Ukrainian and
  English — steps 2, 5, 6
- [ ] Forms work without client JavaScript — steps 6, 7 (manual check with JS off)

## Out of scope
- Deleting the account, email verification and password reset by email.
- An outbox or retries for the email-change notice (it's best effort).
- Revoking sessions on other devices after a password change.
- Saved Nova Poshta addresses and marketing preferences.
- A `users.updated_at` column or any migration.
