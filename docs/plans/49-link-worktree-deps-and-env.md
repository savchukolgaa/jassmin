# Plan: Link worktree dependencies and .env to the main checkout for faster development (#49)

Issue: https://github.com/savchukolgaa/jassmin/issues/49
Branch: `issue/49`
Worktree: `.claude/worktrees/issue-49`
Status: Planned

## Goal
As a developer, I want new issue worktrees to share dependencies and local config with the main
checkout through links, so that creating, using and removing worktrees stays fast even with
several agents working in parallel. Dependencies come from pnpm's shared store through pnpm's
global virtual store (each `node_modules` becomes a small tree of links), and `.env` is linked to
the main checkout's file instead of copied. Worktree creation, `pnpm install` and removal should
get much faster and use far less disk.

## Dependencies & prerequisites
- No dependency issues. Everything this touches exists on `origin/main` (16f789b):
  `pnpm-workspace.yaml`, `scripts/herdr-plans.mjs`, `docs/skills/worktree.md`, `AGENTS.md`,
  `README.md`, the `implement` skills.
- pnpm **12.15.0** (pinned in `package.json` → `packageManager`). Store:
  `%LOCALAPPDATA%\pnpm\store\v11`. `enableGlobalVirtualStore` is currently unset (default off).
- No new packages, env vars or migrations.
- Windows: on the developer machine, unprivileged file symlinks fail with `EPERM` (checked with
  `fs.symlinkSync` during planning, Developer Mode is off). The `.env` fallback path will be the one
  actually used there unless Developer Mode is turned on.

## Decisions & assumptions
- **Global virtual store, configured in `pnpm-workspace.yaml`.** Add `enableGlobalVirtualStore: true`
  next to `allowBuilds`, so the main checkout and every worktree link into the one shared virtual
  store under the pnpm store (`<store>/links`). Each project's `node_modules` then holds only
  links (junctions on Windows, which need no special rights). This is per checkout: a worktree's
  `pnpm install` only rewrites that worktree's links and adds new package versions to the shared
  store, so it can't change what the main checkout resolves (acceptance criterion 4).
- **Spike before committing to it.** Known risk areas for a global virtual store, to be checked in
  step 2: packages that depend on hoisting/phantom dependencies (Strapi's admin build is the
  likeliest), native/build-script packages from `allowBuilds` (`esbuild`, `@swc/core`) and
  `@node-rs/argon2`, Vite resolving real paths outside the project root (`server.fs.allow`,
  dependency pre-bundling), `react-router typegen`, and the root `pnpm install` Aspire runs for
  `db-migrate` (it reads `pnpm-workspace.yaml`; `scripts/aspire.mjs` only overrides `allowBuilds`).
  If something breaks, fix it with the narrowest pnpm setting (e.g. a `publicHoistPattern` entry
  or a Vite `server.fs.allow` entry) and record why in a comment next to the setting. If the global
  virtual store can't be made to work for `cms/` at all, fall back to the closest alternative:
  keep the default isolated layout and only make removal fast (step 6), and document the reason in
  the PR.
- **Spike result (step 2): the global virtual store works as is.** No extra setting was needed:
  `node_modules` entries are junctions into `%LOCALAPPDATA%\pnpm\store11\links`, the lockfile
  is unchanged, Vite serves modules from the store through `/@fs/…` without a `server.fs.allow`
  entry, `react-router typegen`, `tsc`, Biome, Vitest (all 727 tests, with Postgres), `pnpm build`
  and `pnpm cms:build` pass, Strapi loads under `pnpm cms:dev`, and `pnpm aspire run` brings every
  resource up healthy (its root install via `db-migrate-installer` included). PowerShell
  `Remove-Item -Recurse -Force`, `cmd /c rmdir /s /q`, Node `fs.rmSync` and Git Bash `rm -rf` all
  remove a junction without touching its target, so none of them can delete the shared store.
- **Link both env files.** Strapi reads its secrets from `cms/.env` (`aspire-apphost/AGENTS.md`,
  README "Content (Strapi CMS)"), and `pnpm cms:build` / `pnpm cms:dev` need them in a worktree too.
  So the same helper links `$WT/.env` → `$MAIN/.env` **and** `$WT/cms/.env` → `$MAIN/cms/.env`
  (each only when the source exists and the target doesn't).
- **Link fallback order: symlink → hard link → copy.** `fs.symlinkSync(source, target, "file")`
  first. On `EPERM` (Windows without Developer Mode), try `fs.linkSync` (NTFS hard links need no
  rights and stay in sync as long as the file is edited in place, which is what editors do for
  `.env`), and only if that fails too (e.g. different volume) copy. Every fallback prints a notice
  saying which kind of link was made and why, so a stale copy is never silent (confirmed by the
  user, see Resolved questions).
- **Git ignores the links already.** Root `.gitignore` has `.env` and `cms/.gitignore` has `.env`;
  both patterns match a symlink or hard link the same as a regular file. `git worktree remove`
  deletes ignored files without `--force`, and deleting a symlink or hard link never touches the
  main checkout's file.
- **`.env` loading follows links.** `app/.server/env.ts` uses `existsSync(".env")` +
  `process.loadEnvFile(".env")`, and Strapi loads `cms/.env` with dotenv; both read through the
  OS, which resolves symlinks transparently. Verified in step 7 rather than assumed.
- **Step 7 deviation: propagation proved without editing the main `.env`.** The issue worktree's
  env files were linked with `node scripts/link-env.mjs` (hard links here, `EPERM` on symlinks);
  `fsutil hardlink list` shows each is the same file as the main checkout's, both load with
  `process.loadEnvFile`, and the full test suite passes against them. Editing the main checkout's
  `.env` just to watch it change was skipped (no writes to the main checkout); the hard-link test in
  `scripts/link-env.test.mjs` covers propagation. Real symlinks couldn't be exercised on this
  machine (Developer Mode off); that test case skips here and runs where symlinks are allowed.
- **One shared helper, tested.** Put the linking logic in `scripts/link-env.mjs`
  (`linkEnvFiles(main, wt, log = console.log)` → returns what it did per file), used by
  `scripts/herdr-plans.mjs` (replaces `copyEnv`). Test it in `scripts/link-env.test.mjs` with
  Vitest against temp directories, injecting the link functions so the `EPERM` → hard link → copy
  path is testable on any machine. Add `"scripts/**/*.test.mjs"` to `vitest.config.ts` →
  `test.include`. Plain `.mjs` keeps the scripts runnable with bare `node` and outside `tsc` (as
  `herdr-plans.mjs` and `aspire.mjs` are today).
- **Removal relies on `git worktree remove`.** With the global virtual store, `node_modules` is a
  shallow tree of links, so `git worktree remove` should no longer hit "Directory not empty" on a
  huge `node_modules/.pnpm` tree. Document a fast, safe fallback for stubborn cases (a running dev
  server holding a lock, or a worktree created before this change): delete `node_modules` and
  `cms/node_modules` with a tool that **unlinks junctions without following them**, then
  `git worktree remove`. Step 2 verifies which commands are safe (PowerShell 7 `Remove-Item
  -Recurse -Force`, `cmd /c rmdir /s /q`, Node `fs.rmSync`, Git Bash `rm -rf`) by checking that the
  shared store is untouched afterwards; only verified commands go into the docs.
- **Measure on the same machine with a warm store.** "Before" numbers come from a throwaway
  worktree on `origin/main` (no global virtual store), "after" from one on `issue/49`. Record them
  in a scratch note and copy them into the PR (the issue asks for them there, not in the repo).
- Aspire's own `aspire-apphost/` package (installed with `--ignore-workspace`) is untouched.

## Resolved questions
- **Is a hard link an acceptable middle fallback for `.env`?** — Yes: symlink → hard link → copy,
  each fallback with a printed notice. A plain symlink → copy order would give every worktree on
  this machine a stale copy, since symlinks fail with `EPERM`. (source: user, on the plan for #49)
- **Removal script or documentation only?** — Documentation only, in `docs/skills/worktree.md` and
  `docs/skills/open-pr.md`; no `pnpm worktree:remove` script, unless the spike shows
  `git worktree remove` alone is still slow. (source: user, on the plan for #49)
- **Should `scripts/herdr-plans.mjs` also run `pnpm install`?** — No; agents install when they
  need to (per the `implement` skill), so the README row only changes "copies" to "links".
  (source: user, on the plan for #49)
- **Which pnpm version, and where does it read the setting?** — pnpm 12.15.0; workspace settings
  live in `pnpm-workspace.yaml` (that's where `allowBuilds` already is, and `pnpm config list`
  shows them). (source: `package.json`, `pnpm-workspace.yaml`)
- **Does Aspire's root install see the setting?** — Yes: `db-migrate` uses `withPnpm()`, the root
  install reads `pnpm-workspace.yaml`; `scripts/aspire.mjs` only overrides `allowBuilds` through
  `pnpm_config_allow_builds`. The AppHost's own `--ignore-workspace` install is out of scope.
  (source: `aspire-apphost/apphost.mts`, `aspire-apphost/AGENTS.md`, `scripts/aspire.mjs`)
- **Is the `.env` link ignored by git?** — Yes: `.env` in `.gitignore` and `cms/.gitignore` matches
  links as well. (source: `.gitignore`, `cms/.gitignore`)
- **How does the app load `.env`?** — `process.loadEnvFile(".env")` from the process cwd when the
  file exists; it follows symlinks. (source: `app/.server/env.ts`)
- **Does Strapi need its own env file in worktrees?** — Yes, `cms/.env` holds Strapi's secrets.
  (source: `aspire-apphost/AGENTS.md`, `README.md`)
- **Can file symlinks be created here?** — No: `fs.symlinkSync(..., "file")` fails with `EPERM`
  (Developer Mode off), so the fallback must be solid. (source: check during planning)
- **Are worktrees excluded from tooling?** — Yes: Vite watch ignores `**/.claude/worktrees/**`,
  `tsconfig.json` excludes `.claude`, Biome excludes it. (source: `vite.config.ts`,
  `tsconfig.json`, `biome.json`)
- **Where else is "copy `.env`" written down?** — `AGENTS.md` (Workflow), `docs/skills/worktree.md`
  (setup step 3), `.claude/skills/implement/SKILL.md` and `.agents/skills/implement/SKILL.md`
  (step 1), and `scripts/herdr-plans.mjs` (header comment, `copyEnv`, agent prompt).

## Files
| Action | Path | Purpose |
|--------|------|---------|
| modify | `pnpm-workspace.yaml` | `enableGlobalVirtualStore: true` (plus any narrow fix the spike needs, with a comment) |
| modify | `pnpm-lock.yaml` | Only if the install rewrites it (settings checksum); commit whatever pnpm produces |
| create | `scripts/link-env.mjs` | `linkEnvFiles(main, wt)`: symlink → hard link → copy for `.env` and `cms/.env`, with notices |
| create | `scripts/link-env.test.mjs` | Vitest tests for every link path and the skip cases |
| modify | `vitest.config.ts` | Include `scripts/**/*.test.mjs` |
| modify | `scripts/herdr-plans.mjs` | Use `linkEnvFiles` instead of `copyEnv`; update header comment and agent prompt |
| modify | `docs/skills/worktree.md` | Link env files, install with the global virtual store, fast/safe removal |
| modify | `docs/skills/open-pr.md` | Cleanup section points at the removal procedure in `worktree.md` |
| modify | `.claude/skills/implement/SKILL.md` | "link `.env` (see worktree.md)" instead of "copy" |
| modify | `.agents/skills/implement/SKILL.md` | Same as above |
| modify | `AGENTS.md` | Workflow section: link env files, removal note |
| modify | `README.md` | Setup note on the shared virtual store; `pnpm herdr:plans` row ("links `.env`") |

## Steps
Each step is small, ordered, and leaves the app in a working state.

- [x] **1. Measure the baseline** — From the main checkout, create a throwaway worktree on
  `origin/main` (e.g. `.claude/worktrees/bench-before`, detached), copy both env files, and time
  `git worktree add` + `pnpm install` (warm store) with PowerShell `Measure-Command`. Record the
  `node_modules` and `cms/node_modules` size and file count (`Get-ChildItem -Recurse -Force |
  Measure-Object -Sum Length`) and the time for `git worktree remove` (note if it fails with
  "Directory not empty" and how long manual deletion takes). Write the numbers to a scratch note
  outside the repo for the PR.
- [x] **2. Spike the global virtual store** — In the issue worktree, add
  `enableGlobalVirtualStore: true` to `pnpm-workspace.yaml`, run `pnpm install`, and confirm
  `node_modules/<pkg>` entries are links into `<store>/links` (`Get-Item node_modules/react |
  Select LinkType, Target`). Then run, in the worktree **and** the main checkout (after a
  `pnpm install` there too, since the setting is per checkout once merged; for the spike, test the
  main checkout by checking out the branch's `pnpm-workspace.yaml` in a second throwaway
  worktree instead of touching the main checkout): `pnpm typecheck`, `pnpm lint`, `pnpm test`,
  `pnpm build`, `pnpm dev` (load `/`), `pnpm cms:build`, `pnpm cms:dev` (load `/admin`),
  `pnpm aspire run` (all resources healthy). Fix any breakage with the narrowest setting and a
  comment. Also verify which delete commands unlink junctions without following them (create a
  scratch junction to a scratch dir, delete it with each tool, check the target survives). If the
  global virtual store can't work, stop, document why, and switch to the fallback in Decisions.
- [x] **3. Add `scripts/link-env.mjs`** — Export `linkEnvFiles(main, wt, { log, fs })` that, for
  `[".env", "cms/.env"]`, skips when the source is missing or the target already exists (`lstat`,
  so an existing link counts), then tries `symlinkSync(source, target, "file")`, on failure
  `linkSync`, on failure `copyFileSync`, logging a notice for each fallback (with the error code).
  Return `[{ file, result: "symlink" | "hardlink" | "copy" | "exists" | "no-source" }]`. JSDoc
  types, Biome-clean.
- [x] **4. Test it** — `scripts/link-env.test.mjs` with Vitest and temp dirs (`mkdtempSync` in
  `os.tmpdir()`): skips without a source; leaves an existing target alone; falls back to a hard link
  when `symlinkSync` throws `EPERM` (inject an `fs` whose `symlinkSync` throws); falls back to a
  copy when both link calls throw, and logs notices; creates a real symlink when the platform
  allows it (skip that case when the real `symlinkSync` throws `EPERM`). Add
  `"scripts/**/*.test.mjs"` to `vitest.config.ts`. `pnpm test` passes.
- [x] **5. Use it in `scripts/herdr-plans.mjs`** — Replace `copyEnv` with `linkEnvFiles(main, wt)`
  for both new and existing worktrees; update the header comment ("links `.env` and `cms/.env`")
  and the agent prompt ("the env files are already linked"). Smoke-test with a throwaway issue
  number if Herdr is available, otherwise by importing `linkEnvFiles` against a scratch worktree.
- [x] **6. Document setup and removal in `docs/skills/worktree.md`** — Setup step 3: link both env
  files (show the PowerShell/bash commands, or `node -e "import('./scripts/link-env.mjs')…"`, with
  the fallback order and that a copy goes stale). Step 4: `pnpm install` now only creates links
  into the shared virtual store and never changes the main checkout. Cleanup: stop dev servers,
  `git worktree remove`, and the verified fast fallback for stubborn `node_modules` (only commands
  that passed the junction test in step 2), plus a warning never to use a delete command that
  follows junctions. Point `docs/skills/open-pr.md` cleanup at this section.
- [x] **7. Verify `.env` loading through links** — In the worktree with linked env files (symlink if
  allowed, otherwise hard link): `pnpm dev` boots and validates env; `pnpm cms:build` and
  `pnpm cms:dev` read `cms/.env`; edit a harmless variable in the main checkout's `.env` and confirm
  the worktree sees it (symlink and hard link cases). `git -C "$WT" status` shows no `.env`.
- [ ] **8. Update `AGENTS.md`, `README.md` and the `implement` skills** — `AGENTS.md` Workflow: "run
  `pnpm install` and link `.env` and `cms/.env` from the main checkout (see
  `docs/skills/worktree.md`)" and the removal note. `README.md`: a sentence in setup/Development
  that pnpm uses a global virtual store (deps are links into the pnpm store, so `node_modules` is
  small and shared across worktrees), and the `pnpm herdr:plans` row says it links the env files.
  Both `implement` SKILL.md files: "link" instead of "copy", referencing `worktree.md`.
- [ ] **9. Measure after and check isolation** — Repeat step 1's measurements with a throwaway
  worktree on `issue/49`. Isolation check: in a throwaway worktree, `pnpm add -D` a small package
  (or bump one), `pnpm install`, and confirm the main checkout's `node_modules` links, lockfile and
  `pnpm ls` output are unchanged; then discard. Remove the throwaway worktrees with
  `git worktree remove` and record the timings. Run `pnpm typecheck`, `pnpm lint`, `pnpm test`,
  `pnpm build`.

## Testing & verification
- Automated: `scripts/link-env.test.mjs` (symlink, hard-link fallback, copy fallback with notice,
  skip when source missing, skip when target exists).
- Commands in the worktree: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`,
  `pnpm cms:build`; before finishing, the same plus `pnpm dev`, `pnpm cms:dev` and
  `pnpm aspire run` in both a worktree and a checkout with the new `pnpm-workspace.yaml`.
- Manual: link inspection (`Get-Item … | Select LinkType, Target`), env change propagation, the
  junction-safe delete check, the dependency-isolation check, and before/after timings
  (`git worktree add` + `pnpm install`, `git worktree remove`, `node_modules` size/file count) for
  the PR.

## Acceptance criteria
- [ ] A new worktree's `node_modules` links into one shared store instead of holding a full copy of
  the dependency tree — steps 2, 9
- [ ] `pnpm install` in a fresh worktree is measurably faster than before (numbers in the PR) —
  steps 1, 9
- [ ] Removing a merged worktree works with `git worktree remove` and is measurably faster than
  before — steps 1, 6, 9
- [ ] Running `pnpm install` in a worktree after changing dependencies doesn't change the main
  checkout's dependencies — step 9
- [ ] A worktree's `.env` is a symlink to the main checkout's `.env`, with a working copy fallback
  when symlinks aren't permitted — steps 3, 4, 5, 7
- [ ] `pnpm dev`, `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm cms:build` and
  `pnpm aspire run` work in both the main checkout and a worktree — steps 2, 7, 9
- [ ] `docs/skills/worktree.md`, `AGENTS.md`, `README.md` and `scripts/herdr-plans.mjs` describe
  and use the new setup — steps 5, 6, 8

## Out of scope
- Changing the pnpm version or the package manager.
- Anything Aspire-specific, including `aspire-apphost/`'s own `--ignore-workspace` install.
- Sharing the main checkout's whole `node_modules` through one directory link.
- Turning on Windows Developer Mode for the user (only mentioned in docs as the way to get real
  symlinks).
- Committing the benchmark numbers to the repo (they go in the PR description).
