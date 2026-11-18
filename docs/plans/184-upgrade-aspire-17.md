# Plan: Upgrade Aspire from 13.6 to 17.0 for local development and the Hetzner deploy (#184)

Issue: https://github.com/savchukolgaa/jassmin/issues/184
Branch: `issue/184`
Worktree: `.claude/worktrees/issue-184`
Status: Planned

## Goal

Move the repo from Aspire 13.6.3 to Aspire 17.0.0, the CLI and the pinned SDK and hosting packages
together, so the CLI stops rewriting `aspire.config.json` and we get the new version's fixes.
`pnpm aspire run` (every dashboard resource), the Compose publish and `pnpm aspire:deploy` must keep
working, and the docs must say which CLI version to install and how to upgrade next time.

## Dependencies & prerequisites

- **#176 (Hetzner deploy)** is merged (`ad0c439`): `production.mts`, `Aspire.Hosting.Docker` and the
  `deploy-ssh` pipeline step exist.
- **Aspire 17.0.0 exists and is stable**: `gh release list -R microsoft/aspire` lists `v17.0.0` as
  *Latest*, released 2026-11-18, not a preview. The only releases in between are the patches 13.6.4
  and 13.6.5. There are no 14, 15 or 16 releases, because Aspire jumped from 13.x to 17.
- The local CLI is `13.6.4+c8935270`. It has to be updated with `aspire update --self` before
  `aspire update` runs in the worktree.
- `~/.aspire/deployments/` is empty on this machine, so no production deploy has run from here yet.
  No generated production secrets are at risk, but there's also no 13.6.3 deployment to compare against.
- Docker Desktop has to be running for `pnpm aspire run`, `publish` and `do push`. `uv` has to be on
  the PATH for the analytics resources.
- No new packages for the app, no migrations, no new environment variables.

## Breaking changes 13.6.3 → 17.0.0 and their effect here

These come from https://aspire.dev/whats-new/aspire-17/, the
[17.0 change log](https://github.com/microsoft/aspire/wiki/17.0-Change-log) and the 13.6.4 and 13.6.5
release notes. The PR description lists them, each with how it was handled. Step 3 confirms each
one against the regenerated SDK.

| Change | Affects us? | Handling |
|---|---|---|
| Secrets move to Aspire-owned files `~/.aspire/secrets/<apphost-id>/<env>.json`. Development user secrets are imported automatically (#20135). | **Yes**: the persisted dev parameters `cms-sync-secret` and `jupyter-token`, and the production deployment state. | Step 5 checks that run mode keeps the same `cms-sync-secret` (Strapi and `web` must still agree) and that `jupyter-token` still works. Step 7 checks where `aspire do` keeps the deployment state now and updates the backup instructions in `docs/deploy.md` (which point at `~/.aspire/deployments/<hash>/production.json`). |
| Required parameters reject empty values; `asOptional()` exists in TypeScript. | **Check**: production `addParameter`s (`smtp-url`, `email-webhook-secret`, `strapi-api-token`, `strapi-sync-token`, …). | None of them may be empty: the tokens use `pending` until Strapi exists (docs/deploy.md). Keep them required. Run mode forwards `AI_*` only when set, so nothing changes there. Document that an empty answer is now rejected. |
| The default PostgreSQL image is now `18.6`. | **Run mode**: `addPostgres("postgres")` has no tag. | It's the same major version (18), so the data volume stays compatible. Production pins `withImageTag("18")`, so nothing changes there. |
| Docker Compose publish fails fast on unterminated quoted `.env` values (#20620). | Maybe | Step 6 publishes and runs `docker compose config`. |
| Generated Compose dashboards use the 17.0 image and turn telemetry off. | No | `withDashboard({ enabled: false })`. |
| `ReferenceExpressionBuilder` escapes literal braces. | No | The `refExpr` templates (`https://${…}`, `${endpoint}/lab?token=${…}`) have no literal braces. Step 5 checks the JupyterLab link. |
| Colon-style polyglot feature keys are renamed (`experimentalPolyglot:java` → `experimentalPolyglotJava`). | No | `aspire config list` shows no feature keys and no global config, and TypeScript needs no flag. |
| `AddCSharpApp` and `Aspire.AppHost.Sdk` are obsolete, .NET 10 is the minimum, guest AppHosts build in Debug. | No | This is a TypeScript AppHost with no .NET projects. |
| The skills bundle and `--aspire-source` are removed. OTLP max request size is 64 MiB. Telemetry attributes are renamed. AKS, Cosmos, Azure AI, Swarm, SQL Server, Let's Encrypt and RabbitMQ/MongoDB changes. | No | Not used. |
| 13.6.4: DCP create-timeout recovery. 13.6.5: dashboard auth and CLI hardening. | No API change | These are free fixes. |

Anything the regenerated `.aspire/modules/aspire.mts` changes that the notes don't mention (renamed
or removed methods, options objects) shows up as a `pnpm aspire:build` error in step 3, and goes into
the same PR table.

## Decisions & assumptions

- **Target 17.0.0** (stable, *Latest*), not 13.6.5. The issue asks for the latest stable release,
  and 17.0.0 is stable. **(unconfirmed, see Q1)**
- **One exact version everywhere**: `sdk.version` and all three `packages.*` in `aspire.config.json`
  are `17.0.0`. The README prerequisite says *Aspire CLI 17.0.0* rather than "≥ 13.4", because a CLI
  whose version differs from the pin is what triggers the update prompt and rewrites the file.
- `aspire update` (not hand edits) changes `aspire.config.json`, `aspire-apphost/package.json` and
  `aspire-apphost/pnpm-lock.yaml`. Then review the diff: keep the `profiles` block and the key order,
  and don't commit anything under `aspire-apphost/.aspire/` (already git-ignored).
- No new Aspire features (no `withOptional`, no new dashboard settings), as the issue says.
- `scripts/aspire.mjs` changes only if a flag we use (`do`, `-o`, `--list-steps`) changed. The notes
  list none.
- Also remove the duplicated `aspire-output/` block in `.gitignore` (lines 12–16 repeat the
  comment and the entry). It's tiny and touches the same Aspire area.
- The production deploy is verified **up to the SSH step**: `aspire do push` + `prepare-jassmin`,
  then `deploy-ssh` without `DEPLOY_SSH_TARGET`, which must fail with our own message. A real deploy
  happens only if the server exists. **(unconfirmed, see Q2)**

## Open questions

- [ ] **Q1: Go to 17.0.0 today, or wait for 17.0.1?** Why it matters: 17.0.0 came out today
  (2026-11-18). A first major release often gets a quick patch, and every patch means another
  CLI + pin bump. Recommended default: upgrade to 17.0.0 now, as the issue asks. If a blocker turns
  up in steps 3–7 that a patch would fix, stop and report instead of working around it. Affects steps: 1–2.
- [ ] **Q2: Does the Hetzner server exist yet, and should this PR deploy to it?** Why it matters:
  `~/.aspire/deployments/` is empty here, so no deploy has run from this machine. A real deploy would
  also prove the generated secrets survive the new secrets store. Recommended default: no real
  deploy. Verify up to the SSH step and push the images to GHCR only if `docker login ghcr.io` is
  already set up; otherwise stop after `prepare-jassmin`. Affects steps: 7.
- [ ] **Q3: Should the "Upgrading Aspire" note be a section in `aspire-apphost/AGENTS.md` (for
  agents) and the README (for people), or a new `docs/aspire-upgrade.md`?** Why it matters: it's
  only where the note goes. Recommended default: a short "Upgrading Aspire" section in `docs/setup.md`,
  linked from the README prerequisites, plus one rule in `aspire-apphost/AGENTS.md`. Affects steps: 8.

## Resolved questions

- **Does 17.0 exist, and is it a preview?** It's `v17.0.0`, stable and *Latest*, from 2026-11-18.
  Nothing between 13.6 and 17 except the 13.6.4 and 13.6.5 patches (source: `gh release list -R microsoft/aspire`).
- **Which packages are pinned?** `Aspire.Hosting.JavaScript`, `.PostgreSQL` and `.Docker`, all at
  13.6.3, with SDK 13.6.3 (source: `aspire.config.json`).
- **Is `.aspire/modules/` committed?** No, it's git-ignored and regenerated (source: `.gitignore`,
  `aspire-apphost/AGENTS.md`).
- **Do any feature-flag renames apply?** No, there are no feature keys locally or globally (source:
  `aspire config list`).
- **Do the CLI flags `scripts/aspire.mjs` and `package.json` use still exist?** `do`, `-o`,
  `--list-steps` aren't in any breaking change (source: the 17.0 change log). Step 7 checks
  `aspire do --help`. The `--list-steps` "connection lost" exit-6 bug is fixed in 17.0.
- **Is there production deployment state to protect?** Not on this machine: `~/.aspire/deployments/`
  is empty.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `aspire.config.json` | SDK + 3 packages → `17.0.0` (via `aspire update`) |
| modify | `aspire-apphost/package.json` | Whatever `aspire update` changes (dependencies of the generated SDK) |
| modify | `aspire-apphost/pnpm-lock.yaml` | Regenerated lockfile |
| modify (if needed) | `aspire-apphost/apphost.mts` | Adapt to renamed or changed SDK APIs |
| modify (if needed) | `aspire-apphost/production.mts` | Adapt Compose, pipeline or parameter APIs |
| modify (if needed) | `aspire-apphost/tsconfig.apphost.json` | If the generated module file list changes (`aspire.mts`, `base.mts`, `transport.mts`) |
| modify (if needed) | `scripts/aspire.mjs`, `package.json` | Only if CLI flags changed |
| modify | `.gitignore` | Remove the duplicated `aspire-output/` block |
| modify | `README.md` | Prerequisites: Aspire CLI 17.0.0, how to install or update it, link to the upgrade note |
| modify | `aspire-apphost/AGENTS.md` | Version rule, new secrets location, any API renames |
| modify | `docs/deploy.md` | Where the deployment state and secrets live now (backup section), the required-parameter note |
| modify | `docs/setup.md` | "Upgrading Aspire" section (Q3) |
| delete (before merge) | `docs/plans/184-upgrade-aspire-17.md` | Per workflow |

## Steps

- [ ] **1. Baseline on 13.6.3** — Before upgrading, in the worktree: `pnpm install`,
  `pnpm aspire restore` (regenerates `.aspire/modules/` for 13.6.3), `pnpm aspire:build`. Then
  `pnpm aspire publish -o "$SCRATCH/compose-13.6.3"` and `pnpm aspire do --list-steps > "$SCRATCH/steps-13.6.3.txt"`
  (scratchpad, never committed). Save the 13.6.3 generated SDK's exported names
  (`grep -o "^export [a-z]* [A-Za-z]*" .aspire/modules/aspire.mts`) for the diff in step 3.
  Back up `~/.aspire/` (at least `secrets/` and the user-secrets file for this AppHost, if any) to
  the scratchpad, so step 5 can restore it if the import goes wrong.
- [ ] **2. Update the CLI, then the repo** — `aspire update --self` (to 17.0.0), check with
  `aspire --version`. Then `pnpm aspire update` in the worktree (it goes through the wrapper so
  pnpm's `allowBuilds` apply to the AppHost install). Check that `aspire.config.json` has
  `sdk.version` and all three packages at `17.0.0`, that `profiles` and `appHost` are unchanged,
  and that only the expected files changed in `git status`. Don't run `--migrate` unless the CLI
  says it's required; if it does, record what it changed.
- [ ] **3. Fix the AppHost against the new SDK** — `pnpm aspire:build`. Compare the regenerated
  `.aspire/modules/aspire.mts` exports with the step 1 list for every API the AppHost uses:
  `createBuilder({ dashboardApplicationName })`, `executionContext().isPublishMode()`, `addPostgres`
  /`withDataVolume`/`addDatabase({ databaseName })`/`uriExpression`, `addJavaScriptApp`/`addViteApp`/
  `withPnpm({ install })`/`withRunScript`, `addExecutable`, `addContainer`/`withImageTag`/`withEndpoint`,
  `addParameterWithGeneratedValue`, `addParameter({ secret, value, publishValueAsDefault })`/`withDescription`,
  `withHttpHealthCheck`, `withExplicitStart`, `waitForCompletion`, `withParentRelationship`, `withUrl`/
  `refExpr`/`getEndpoint`/`EndpointProperty`, `addDockerComposeEnvironment`/`withDashboard`/
  `publishAsDockerComposeService` (`compose.restart.set`), `addContainerRegistry`/`withContainerRegistry`,
  `addDockerfile({ stage, dockerfilePath })`/`withArgs`/`withVolume`/`withBindMount`, and
  `pipeline().addStep(name, fn, { dependsOn })` with `PipelineStepContext.reportingStep()`/`createTask`/
  `completeTask`/`completeStep`. Fix each compile error with the smallest change, and note each one
  for the PR table. Update `tsconfig.apphost.json` if the generated module file names changed. Then
  `pnpm lint` (Biome covers `apphost.mts` and `production.mts`) and `pnpm typecheck`.
- [ ] **4. Check that the pipeline step names still exist** — `pnpm aspire do --list-steps`, then
  diff against `steps-13.6.3.txt`. `deploy-ssh` depends on `push` and `prepare-jassmin`. If either
  was renamed, update `dependsOn`, the comments in `production.mts`, `aspire-apphost/AGENTS.md` and
  `docs/deploy.md`. Check `aspire do --help` for `-o` and `scripts/aspire.mjs`'s assumptions, and
  update `package.json` `aspire:deploy` only if a flag changed.
- [ ] **5. Run mode: every resource** — `pnpm aspire run`, and check against `aspire-apphost/AGENTS.md`:
  - `postgres` (now `18.6`, the existing data volume still opens), `jassmindb`, `strapidb`,
    `jassmin-synth`; `db-migrate` completes; `web` starts and its endpoint serves the shop; `cms` is
    healthy (`/_health` 204); `smtp4dev` UI opens.
  - `cms-sync-secret` is the same value as before the upgrade (the dashboard parameter, or a Strapi
    product edit writes through to the app without a 401). `jupyter-token` persists across two runs.
  - Explicit-start: `db-seed`, `db-import-catalog`, `db-apply-catalog-prices`, `db-rollback` (skip
    on real data, or check it's listed and startable), `db-mark-abandoned-carts`,
    `db-cancel-unpaid-orders`, `db-expire-gift-cards`, `db-prune-rate-limits`, `db-send-order-emails`
    (mail shows in smtp4dev), `db-sync-cms`, `db-backfill-product-images`, `cms-seed`,
    `synth-generate` → `dbt-build` → `ml-notebooks`, `dbt-docs` (docs page opens), `jupyter-lab` (the
    `JupyterLab` link opens without a login page).
  - The dashboard is titled "Jassmin". Stop with `pnpm aspire stop`, run again, and `git status`
    must show **no change to `aspire.config.json`** (acceptance criterion).
- [ ] **6. Publish** — `pnpm aspire publish -o "$SCRATCH/compose-17.0.0"`. Diff `docker-compose.yaml`
  against the 13.6.3 one: same services (`postgres`, `db-migrate`, `cms`, `web`, `scheduler`,
  `pg-backup`, `proxy`), images, volumes, `restart: unless-stopped`, only the proxy's host ports, the
  same environment variable names. Expected differences, such as the image naming or the postgres
  default tag (production pins `18`), get explained in the PR. Check that the `.env` template has
  only empty or placeholder values (`grep -E '=.+' .env` returns only non-secret defaults such as
  `registry-endpoint`) and that `docker compose -f … config` validates it.
- [ ] **7. Deploy, up to the SSH step** — Run `pnpm aspire do prepare-jassmin -o aspire-output`
  (asks for or reuses the parameters; enter throwaway test values, never real secrets, if no
  deployment state exists). It must write `aspire-output/.env.Production` and `docker-compose.yaml`.
  Note where 17.0 stores the deployment state (`~/.aspire/deployments/…` or `~/.aspire/secrets/…`)
  for `docs/deploy.md`. Then run `pnpm aspire:deploy` **without** `DEPLOY_SSH_TARGET`: `push` runs
  (if `docker login ghcr.io` is set up, Q2), and `deploy-ssh` must fail with our "Set
  DEPLOY_SSH_TARGET…" message. A real deploy happens only if Q2 says the server exists. Afterwards,
  delete the throwaway deployment state and `aspire-output/` so the real first deploy starts clean.
- [ ] **8. Docs** —
  - `README.md` → Prerequisites: "Aspire CLI **17.0.0**", the install commands, `aspire update --self`
    to update an existing CLI, and a link to the upgrade note.
  - `aspire-apphost/AGENTS.md`: the CLI version must equal `sdk.version` in `aspire.config.json`.
    Don't commit a CLI-only rewrite of that file. Also any API renames from step 3, and the new
    secrets location.
  - `docs/deploy.md`: the backup path for the deployment state and secrets, a note that empty
    answers to required parameters are rejected, and any step-name changes.
  - "Upgrading Aspire" (Q3): one PR on an `issue/<n>` branch; update the CLI first
    (`aspire update --self`), then `pnpm aspire update` in the worktree; read the release notes for
    every version in between; check `pnpm aspire:build`, `run`, `publish` and the deploy up to SSH;
    never commit an `aspire.config.json` change made by a CLI update on `main`; and everyone updates
    their CLI after the merge.
  - Fix the duplicated `aspire-output/` block in `.gitignore`.
- [ ] **9. Full checks and commit** — `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
  Stage paths explicitly (`aspire.config.json`, `aspire-apphost/package.json`,
  `aspire-apphost/pnpm-lock.yaml`, the changed `.mts` files, the docs, `.gitignore`) and check that
  nothing under `aspire-apphost/.aspire/` or `aspire-output/` is staged. Write the PR's breaking-change
  table from the section above plus the step 3 findings.

## Testing & verification

- No new Vitest tests: the app code doesn't change. The AppHost has no unit tests, and it's checked
  by `pnpm aspire:build` (`tsc -p tsconfig.apphost.json`, TypeScript 7) and Biome.
- Commands: `pnpm aspire:build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Manual: steps 5 (run mode, every resource), 6 (publish diff + `docker compose config`) and 7
  (deploy up to SSH), and a `git status` after running the CLI to show `aspire.config.json` stays unchanged.

## Acceptance criteria

- [ ] `aspire.config.json` pins one Aspire version (17.0 or the latest stable) for the SDK and all packages, matching the CLI in the README: steps 2, 8
- [ ] The breaking changes between 13.6.3 and the new version that affect this repo are listed in the PR, each with how it was handled: the breaking-change table above, steps 3, 4, 9
- [ ] `pnpm aspire:build` passes, and `pnpm aspire run` starts every resource as documented: steps 3, 5
- [ ] `pnpm aspire publish` produces a working Docker Compose setup, and `pnpm aspire:deploy` works or is verified up to the SSH step: steps 6, 7
- [ ] Running the upgraded CLI no longer changes `aspire.config.json` in a clean checkout: steps 2, 5
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass: step 9

## Out of scope

- New Aspire 17 features (optional parameters, config sources, the new dashboard options, TypeScript
  hosting integrations). They can come in later issues.
- Changing the deploy target, the Compose services or the Dockerfiles.
- Pinning the dev Postgres image tag (it stays on Aspire's default, now 18.6).
- Upgrading Node, pnpm or TypeScript.
