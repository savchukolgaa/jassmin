# AGENTS.md

Guidance for AI coding agents working in this repository. Read `README.md` for setup. Scoped rules live in `app/.server/AGENTS.md` and `aspire-apphost/AGENTS.md`.

## Project

Jassmin is an e-commerce site for a small perfume store in Ukraine. It's a single full-stack SSR app built on React Router v8 (framework mode), TypeScript 7, Tailwind v4, PostgreSQL with Drizzle ORM, zod, Biome and Vitest. Local development is orchestrated by Aspire, and pnpm is the package manager.

There is no in-app admin area: staff manage products and orders in the Strapi admin (`cms/`), which writes every edit through to PostgreSQL, the system of record (#40; see `app/.server/AGENTS.md` → CMS sync).

The database schema is designed for later LTV and churn analytics. Columns such as `users.last_login_at`, `users.acquisition_channel`, `products.fragrance_family` and `carts.abandoned_at` are ML features: never drop or rename them.

## Commands

Always use **pnpm**, never npm or yarn.

```bash
pnpm install
pnpm typecheck      # react-router typegen && tsc
pnpm lint           # biome check .
pnpm format         # biome check --write .
pnpm test           # vitest run
pnpm build
pnpm aspire run     # never plain `aspire run`, see aspire-apphost/AGENTS.md
```

Before every commit, `pnpm typecheck`, `pnpm lint` and `pnpm test` must pass. Before finishing an issue, `pnpm build` must pass too.

## Architecture rules

- **Reads go in route `loader`s, writes in route `action`s.** No REST API layer and no client-side fetching libraries (no React Query, Axios or Zustand).
- Routes are declared in `app/routes.ts`. Type route modules with the generated types: `import type { Route } from "./+types/<route>"`.
- **Server-only code goes under `app/.server/`** (DB, services, session, env). Never import it from client code; the build fails if you do.
- Shared enums and DTO types go in `app/lib/` (isomorphic, with no server imports).
- Shared UI goes in `app/components/`, feature UI in `app/features/<feature>/`.
- UI work follows the Option C+ design in `docs/design.md` (tokens, typeface, buttons, focus rings, motion).

## Code rules

- Strict TypeScript. **No `any`** (Biome `noExplicitAny` is an error). Use `unknown` plus narrowing, or proper types.
- `noUncheckedIndexedAccess` is on, so handle `arr[0]` being `undefined`.
- Use `import type` for type-only imports (Biome `useImportType`).
- Validate **every** `action` input with zod, and return typed errors instead of throwing for user mistakes.
- Use a DB transaction (`db.transaction(async (tx) => …)`) wherever several writes must succeed together, especially at checkout: decrementing stock, creating the order and order items, and marking the cart `converted`.
- Add or update Vitest tests next to the code (`*.test.ts`) for the behaviour you add.
- Match the surrounding code's style. Biome formats the code: 2 spaces, double quotes, LF, width 100.

## Translations (i18n)

The site is in Ukrainian (default) and English. The locale comes from the `locale` cookie, then
`Accept-Language`, then `uk` (`app/.server/locale.ts`).

- **No hard-coded user-facing strings.** Copy lives in `app/lib/i18n/uk.ts` (the source of truth)
  and `app/lib/i18n/en.ts`, under one namespace per feature (`cart`, `checkout`,
  `account`, …). Add every key to both files; `pnpm typecheck` fails when they differ.
- Components use `const { t } = useT()`, route `meta` uses `metaTranslator(matches)`, and server
  code uses `createTranslator(await getLocale(request))`.
- Placeholders are `{name}`. A plural message is `{ one, few, many, other }` in `uk` (`one`/`other`
  in `en`) and needs `t(key, { count })`.
- zod messages and action errors are message keys (`msg("cart.errors.…")`), translated when
  rendered, so action results stay locale-independent.
- Format prices and dates with the translator's `formatPrice` / `formatDate`, never a fixed
  `Intl` locale.
- Component tests render Ukrainian by default; wrap in `<I18nProvider locale="en">` to assert
  English copy.

## Workflow: issues, plans, worktrees

Work happens through the repo skills in `.agents/skills/` (Antigravity) and `.claude/skills/` (Claude): `/create-issue`, `/create-plan <n>`, `/implement <n>` and `/open-pr <n>`. Reusable workflow documentation and templates live in `docs/skills/`.

- **One issue = one branch `issue/<number>` = one git worktree.** Never do issue work in the main checkout.
- Worktrees live **inside** the repo at `.claude/worktrees/issue-<number>` (git-ignored, and excluded from Biome, `tsc` and Vite watching). Create one from the main checkout with:
  ```bash
  git fetch origin
  git worktree add -b issue/<n> .claude/worktrees/issue-<n> origin/main
  ```
  In a new worktree, link `.env` and `cms/.env` to the main checkout's with `node scripts/link-env.mjs` (symlink, or a hard link/copy where Windows doesn't allow symlinks) and run `pnpm install`. pnpm's global virtual store makes `node_modules` a small tree of links into one shared store, so the install is fast and never changes the main checkout (see `docs/skills/worktree.md`).
- All commits for an issue go to `issue/<number>`, inside its worktree. Stage paths explicitly and never use `git add -A` / `git add .`.
- Plans live in `docs/plans/<n>-<slug>.md` while an issue is in progress, and are removed before the PR is merged.
- Remove a worktree only after its PR is merged, with `pnpm worktree:remove <n>`. Never use plain `git worktree remove` or `git clean -x` while the worktree has `node_modules`: Git for Windows follows its junctions and deletes files in pnpm's shared store (see `docs/skills/worktree.md`).

## Never

- Commit `.env`, `Project Overview & Guidelines for Claude.md` (local notes, git-ignored), `build/`, `.react-router/` or `aspire-apphost/.aspire/`.
- Switch the package manager, or add ESLint/Prettier (Biome is the linter and formatter).
- Push to `main` directly.
