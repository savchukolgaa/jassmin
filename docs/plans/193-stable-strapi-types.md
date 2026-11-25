# Plan: Keep Strapi's generated types stable so a Strapi start doesn't block git pull (#193)

Issue: https://github.com/savchukolgaa/jassmin/issues/193
Branch: `issue/193`
Worktree: `.claude/worktrees/issue-193`
Status: Planned

## Goal
As a developer, I want Strapi's generated type files (`cms/types/generated/*.d.ts`) to stay unchanged
when Strapi starts, so that `git pull` doesn't fail on files nobody edited. The committed copies must
be exactly what Strapi's type generator writes for the committed schemas; CI fails when they're out of
date, and the docs say how to update them (`pnpm cms:types`) and how to recover a checkout that already
has them changed.

## Dependencies & prerequisites
- CI workflow from #142 (`.github/workflows/ci.yml`, `docs/ci.md`): exists on `main`.
- Strapi 5.59.0 (`cms/package.json`), which bundles `@strapi/typescript-utils` 5.59.0 with
  TypeScript 5.9.3 and Prettier 3.9.9 (pinned by `pnpm-lock.yaml`). No upgrade (out of scope).
- No new packages, env vars or migrations.

## Findings: the cause (for the PR description)
Checked on a clean `issue/193` (= `origin/main` at 131cf50), Windows 11:

1. **The generator itself is deterministic.** `pnpm --filter jassmin-cms strapi ts:generate-types`
   rewrites both files byte-for-byte identical to the committed ones (`git status` clean, LF endings,
   0 CR bytes). It needs no database: with `DATABASE_URL` pointing at a closed port it still succeeds in
   under a second (after ~20 s of Strapi compile/register), so it can run in CI.
2. **`strapi develop` and `strapi ts:generate-types` run the same code**: `tsUtils.generators.generate`
   (`@strapi/strapi/dist/src/node/develop.js:226`, `.../cli/commands/ts/generate-types.js:20`). Develop
   always runs it for a TS project.
3. **The committed files were hand-edited, twice, so they drifted from what Strapi writes:**
   - #138 (16258be) added `arrivedAtBranch: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;`
     on one 81-character line. Strapi's Prettier pass (width 80) wraps it onto two lines; #181
     (b154d54) committed the wrapped form. This is the "line wrapping" difference.
   - #130 (15944d0) changed `cms/src/components/catalog/variant.json` (new `stockReason` and a longer
     `description`) but added only `stockReason` to `components.d.ts` by hand, not the new description.
     The next Strapi start wrote the description; #181 committed it. This is the "content" difference.
4. **Escapes vs plain Ukrainian text**: Strapi always writes `\u…` escapes (it builds string literals
   with `ts.factory.createStringLiteral`, and the TS printer escapes non-ASCII in synthesized literals;
   Prettier keeps escapes as they are). No commit of the files has ever contained plain Cyrillic
   (checked every commit touching `cms/types/generated`). So the plain-text copy was an uncommitted
   local edit (most likely an agent editing the file by hand), not Strapi output (Q1: not
   reproducible, accepted as the explanation).
5. **A latent source of machine-dependent output**: `format()` in
   `@strapi/typescript-utils/dist/generators/utils.js:62` calls `prettier.resolveConfigFile()` from the
   process cwd (`cms/`) upwards. With no config found it uses `{ singleQuote: true, tabWidth: 2 }` and
   Prettier's defaults (width 80, LF). Any Prettier config in a parent directory (e.g. a
   `.prettierrc` in the user's home, or a `"prettier"` key in a parent `package.json`) would change
   the wrapping on that machine only. None exists on this machine or in the repo today.
6. Line endings: Prettier emits LF and `fs.writeFile` keeps it, so Windows output is LF; the root
   `.gitattributes` (`* text=auto eol=lf`) already normalizes. Biome ignores the folder (`biome.json`).

7. **The pin works** (checked while implementing step 2): with a `.prettierrc` of
   `{"printWidth":120,"singleQuote":false}` in the repo root, `pnpm cms:types` rewrote both files
   (454 insertions, 695 deletions) without the `"prettier"` key in `cms/package.json`, and changed
   nothing with it.

So the fix is mostly process (regenerate, never hand-edit, enforce in CI) plus pinning the Prettier
config so no machine-level config can leak in.

## Decisions & assumptions
- **Keep the files committed** (issue's default). Generating them at install time would need a full
  Strapi compile/register (~20 s) on every `pnpm install`, including in production images, and the
  Strapi TS build and editor types need them before Strapi first starts. Committed + CI check is simpler.
- **Pin the formatter config in `cms/package.json`** with a `"prettier"` key equal to Strapi's
  fallback (`{ "singleQuote": true, "tabWidth": 2, "useTabs": false, "printWidth": 80,
  "endOfLine": "lf" }`). `resolveConfigFile()` stops at the nearest config, so a config in a parent
  directory can no longer change the output, and today's output stays byte-identical (same values).
  This doesn't add Prettier as a tool: it's only read by Strapi's bundled generator; Biome stays the
  formatter. A key in `package.json` avoids a `.prettierrc` file that editors would pick up for
  every file under `cms/`.
- **Scripts**: `cms/package.json` gets `"types": "strapi ts:generate-types"`, the root gets
  `"cms:types": "pnpm --filter jassmin-cms types"` (same shape as `cms:build` / `cms:seed`).
- **CI check goes in the existing `cms` job**, which already runs whenever `cms/**` or the lockfile
  changes, i.e. exactly when a schema change (or a Strapi/Prettier version change) can make the types
  stale. It runs before `Build Strapi`, uses the job's dummy Strapi env, and needs no database. The
  check uses `git status --porcelain -- cms/types/generated` (catches a new untracked file as well as
  changes), prints the diff and an `::error::` annotation saying "run `pnpm cms:types` and commit".
- Add `.github/workflows/ci.yml` to the `cms` paths filter so a change to the job itself (like this
  PR) runs it. The `analytics` filter already does the same.
- `.gitattributes`: add `cms/types/generated/** text eol=lf linguist-generated` — explicit LF (as the
  issue asks; the global rule already covers it) and collapse the files in PR diffs, like notebooks.
- No Vitest test: the behaviour is a CI step over a ~20 s Strapi boot; a unit test would only
  duplicate it. Verification is running the step locally and a deliberate stale-types CI run (see
  Testing).

## Open questions
Both answered by the owner (2026-11-25): use the recommended defaults.
- [x] **Q1: Do you still have the diff with plain Ukrainian letters, or know where it came from?** —
  Why it matters: no commit and no Strapi run produces plain Cyrillic, so the plan explains it as an
  uncommitted hand edit. If it actually came from Strapi (e.g. a different Strapi/TypeScript install,
  or Strapi started from another folder), the fix would also need pinning that. Recommended default:
  write it in the PR as "not reproducible; most likely a hand edit, which the CI check now catches".
  Affects steps: 8 (PR text only).
- [x] **Q2: Is a `"prettier"` key in `cms/package.json` acceptable, given AGENTS.md's "never add
  Prettier"?** — Why it matters: it's the only way to stop a Prettier config elsewhere on a machine
  from changing Strapi's output, but it is Prettier configuration in the repo. Recommended default:
  add it, with a docs line saying it is read only by Strapi's type generator (Prettier isn't installed
  as a tool and Biome stays the formatter). Without it, the CI check still catches any drift, just
  after the fact. Affects steps: 2, 6.

## Resolved questions
- **Does `strapi develop` use different options than `ts:generate-types`?** — No, both call
  `tsUtils.generators.generate` with the same artifacts (source: `@strapi/strapi` 5.59.0
  `dist/src/node/develop.js:223-236`, `dist/src/cli/commands/ts/generate-types.js:16-21`).
- **Is there a `cms/config/typescript.ts` or flag that controls formatting?** — No.
  `typescript.autogenerate` only toggles generation for JS projects; the CLI flags are `--debug`,
  `--silent`, `--out-dir`. Formatting comes only from `prettier.resolveConfigFile()` (source:
  `@strapi/typescript-utils/dist/generators/utils.js:62-75`).
- **Does type generation need a database (matters for CI)?** — No, verified by running it with an
  unreachable `DATABASE_URL`.
- **Are Windows line endings a problem?** — No: output is LF (0 CR bytes) and `.gitattributes`
  normalizes (`* text=auto eol=lf`).
- **Is the current `main` already consistent?** — Yes, regeneration on 131cf50 leaves `git status`
  clean; #181 (b154d54) committed the regenerated files. The step that commits regenerated files is
  therefore a no-op unless Q2's pin changes something (it shouldn't).
- **Where do the agent rules for `cms/` live?** — `app/.server/AGENTS.md` → "CMS: `cms/`", and the root
  `AGENTS.md` for workflow-wide rules (source: those files).

## Files
| Action | Path | Purpose |
|--------|------|---------|
| modify | `cms/package.json` | `types` script; `"prettier"` key pinning the generator's format (Q2) |
| modify | `package.json` | `cms:types` script |
| modify | `.gitattributes` | `cms/types/generated/** text eol=lf linguist-generated` |
| modify | `.github/workflows/ci.yml` | "Check generated Strapi types" step in `cms`; `ci.yml` in the `cms` filter |
| modify | `cms/types/generated/*.d.ts` | Only if `pnpm cms:types` changes them (expected: no change) |
| modify | `docs/setup.md` | Scripts table row; "Generated types" under Content (Strapi CMS); recovery note |
| modify | `docs/ci.md` | The `cms` job's new step and trigger; troubleshooting entry |
| modify | `app/.server/AGENTS.md` | Rule: schema change ⇒ commit `pnpm cms:types` output, never hand-edit |
| modify | `AGENTS.md` | `pnpm cms:types` in Commands, one-line rule pointing to the scoped file |

## Steps
- [x] **1. Add the scripts** — `cms/package.json`: `"types": "strapi ts:generate-types"`. Root
  `package.json`: `"cms:types": "pnpm --filter jassmin-cms types"` next to `cms:build`. Check: `pnpm
  cms:types` runs and `git status` stays clean.
- [x] **2. Pin the generator's Prettier config (Q2)** — add to `cms/package.json`:
  `"prettier": { "singleQuote": true, "tabWidth": 2, "useTabs": false, "printWidth": 80,
  "endOfLine": "lf" }`. Check: `pnpm cms:types` leaves `git status -- cms/types/generated` clean.
  Then prove the pin works: temporarily put a `.prettierrc` with `{"printWidth": 120}` in the
  worktree root, run `pnpm cms:types` (still clean), remove it, and note the result for the PR.
- [x] **3. `.gitattributes`** — add `cms/types/generated/** text eol=lf linguist-generated` with a
  comment pointing to #193. Check: `git ls-files --eol cms/types/generated` shows `i/lf w/lf`.
- [x] **4. Commit any regenerated types** — run `pnpm cms:types`; if it changes anything, commit the
  files (expected: nothing to commit).
- [x] **5. CI check** — in `.github/workflows/ci.yml`:
  - add `".github/workflows/ci.yml"` to the `cms` filter in `changes`;
  - in the `cms` job, after `Install dependencies` and before `Build Strapi`, add:
    ```yaml
    # Strapi regenerates these on every start; the committed copies must match (#193).
    - name: Check generated Strapi types
      run: |
        pnpm cms:types
        if [ -n "$(git status --porcelain -- cms/types/generated)" ]; then
          git --no-pager diff -- cms/types/generated
          echo "::error::cms/types/generated is out of date. Run \`pnpm cms:types\` and commit the result."
          exit 1
        fi
    ```
  Check locally: change a `description` in a `cms/src/**/schema.json`, run the same shell snippet,
  see it fail with the message; revert.
- [ ] **6. Docs: `docs/setup.md`** — Scripts table: `pnpm cms:types` ("Regenerate Strapi's types in
  `cms/types/generated` from the schemas; commit the result"). Under "Content (Strapi CMS)" add a
  "### Generated types" subsection: Strapi rewrites the two files on every start; after changing a
  content type or component, run `pnpm cms:types` (or start Strapi) and commit them with the schema
  change; never edit them by hand; CI fails when they're stale; the `"prettier"` key in
  `cms/package.json` only fixes the generator's output format (Q2). Recovery note: if `git pull`
  refuses because of these files, run `git restore cms/types/generated`, pull, then restart Strapi
  (or `pnpm cms:types`). Add it to the Contents list.
- [ ] **7. Docs: `docs/ci.md` and agent docs** — `docs/ci.md`: update the `cms` row (trigger now
  includes `ci.yml`; steps `pnpm cms:types` check + `pnpm cms:build`) and add a Troubleshooting
  entry for "cms/types/generated is out of date". `app/.server/AGENTS.md` → "CMS: `cms/`": bullet
  "A change to `cms/src/**/schema.json` (content types and components) commits the regenerated
  `cms/types/generated/*.d.ts` from `pnpm cms:types` in the same commit. Never edit them by hand
  (#193)." Root `AGENTS.md`: add `pnpm cms:types` to Commands with a short comment.
- [ ] **8. Verify and write the cause into the PR** — run `pnpm typecheck`, `pnpm lint`, `pnpm test`,
  `pnpm build`, and `pnpm cms:types` (+ `git status` clean). Copy "Findings: the cause" above into the
  PR description (with the Q1 answer).

## Testing & verification
- `pnpm cms:types` on the branch leaves `git status` clean (Windows, locally); the CI `cms` job runs on
  this PR (because `ci.yml` changed) and its new step passes on Linux.
- Negative check: a schema edit without regenerating fails the snippet locally (step 5). Optionally,
  push a throwaway commit to the PR that changes a schema description only, watch the `cms` job fail
  with the `::error::` message, then drop the commit.
- Pin check from step 2 (parent `.prettierrc` doesn't change output).
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` pass. No new Vitest tests (see Decisions).

## Acceptance criteria
- [ ] On a clean `main`, starting Strapi (or `pnpm cms:types`) leaves `git status` clean on Windows and in CI — steps 1–4, 5 (CI run), 8
- [ ] CI fails when a content-type change isn't followed by its regenerated types — step 5
- [ ] The cause of the earlier differences is written in the PR — Findings section, step 8
- [ ] `docs/setup.md` and the agent docs explain how to update the types — steps 6, 7
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass — step 8

## Out of scope
- Changing content types or components, and upgrading Strapi (per the issue).
- Generating the types at install time / git-ignoring them (see Decisions).
- A pre-commit hook; CI is the enforcement point.
- `aspire.config.json` drift (fixed in #184).
