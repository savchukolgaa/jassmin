# AGENTS.md

Guidance for AI coding agents working in this repository. Read `README.md` for setup. Scoped rules live in `app/.server/AGENTS.md` and `aspire-apphost/AGENTS.md`.

## Project

Jassmin is an e-commerce site for a small perfume store in Ukraine. It's a single full-stack SSR app built on React Router v8 (framework mode), TypeScript 7, Tailwind v4, PostgreSQL with Drizzle ORM, zod, Biome and Vitest. Local development is orchestrated by Aspire, and pnpm is the package manager.

The database schema is designed for later LTV and churn analytics. Columns such as `users.last_login_at`, `users.acquisition_channel` and `products.fragrance_family` are ML features: never drop or rename them.

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

## Workflow: issues, plans, worktrees

Work happens through the repo skills in `.agents/skills/` (Antigravity) and `.claude/skills/` (Claude): `/create-issue`, `/create-plan <n>`, `/implement <n>` and `/open-pr <n>`. Reusable workflow documentation and templates live in `docs/skills/`.

- **One issue = one branch `issue/<number>` = one git worktree.** Never do issue work in the main checkout.
- Worktrees live **inside** the repo at `.claude/worktrees/issue-<number>` (git-ignored, and excluded from Biome, `tsc` and Vite watching). Create one from the main checkout with:
  ```bash
  git fetch origin
  git worktree add -b issue/<n> .claude/worktrees/issue-<n> origin/main
  ```
  In a new worktree, run `pnpm install` and copy `.env` from the main checkout.
- All commits for an issue go to `issue/<number>`, inside its worktree. Stage paths explicitly and never use `git add -A` / `git add .`.
- Plans live in `docs/plans/<n>-<slug>.md` while an issue is in progress, and are removed before the PR is merged.
- Remove a worktree only after its PR is merged: `git worktree remove .claude/worktrees/issue-<n>`.

## Never

- Commit `.env`, `Project Overview & Guidelines for Claude.md` (local notes, git-ignored), `build/`, `.react-router/` or `aspire-apphost/.aspire/`.
- Switch the package manager, or add ESLint/Prettier (Biome is the linter and formatter).
- Push to `main` directly.
