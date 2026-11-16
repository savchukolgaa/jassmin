# Plan: Start the ML notebooks and JupyterLab from the Aspire dashboard (#159)

Issue: https://github.com/savchukolgaa/jassmin/issues/159
Branch: `issue/159`
Worktree: `.claude/worktrees/issue-159`
Status: Planned

## Goal

As a developer, I want to start the #133 notebook run and JupyterLab from the Aspire dashboard, so
the whole analytics pipeline (`synth-generate` → `dbt-build` → `ml-notebooks`) runs from one place
without remembering `uv` commands. Two new explicit-start `addExecutable` resources under
`jassmin-synth`, `ml-notebooks` (headless `run_all.py`) and `jupyter-lab` (JupyterLab on an Aspire
endpoint, localhost only), both getting only the synth database as `JASSMIN_SYNTH_URI`.

## Dependencies & prerequisites

- #133 is merged on `origin/main` (8991682): `analytics/notebooks/` with `pyproject.toml` (already
  depends on `jupyterlab>=4.2`, `ipykernel`, `nbclient`), `run_all.py` and `jassmin_ml/db.py`. No
  Python dependency changes needed.
- #131 `synth-generate` and #132 `dbt-build` / `dbt-docs` already exist in
  `aspire-apphost/apphost.mts` and are the pattern to copy.
- `uv` on the PATH (same requirement as the other analytics resources). No new env vars, npm
  packages or migrations.

## Decisions & assumptions

- **Same wiring as `dbt-build` / `dbt-docs`**: `addExecutable(<name>, "uv", "..", [...])`,
  `.withReference(synthDb)`, `.withEnvironment("JASSMIN_SYNTH_URI", await synthDb.uriExpression())`,
  `.waitFor(synthDb)`, `.withParentRelationship(synthDb)`, `.withExplicitStart()`. No
  `withReference(db)`, no `STRAPI_URL`/`SMTP_URL`/`CMS_SYNC_SECRET`, so neither resource gets
  `jassmindb` or the app's environment. Working directory `..` (repo root), like the others.
- **A shared args prefix** `const notebooks = ["run", "--project", "analytics/notebooks"]`, like
  the existing `warehouse` constant.
- **`ml-notebooks`** runs `[...notebooks, "analytics/notebooks/run_all.py"]`. No `waitFor` on
  `dbt-build` (no persistent "built" state); the comment above it and the docs say to run
  `synth-generate` then `dbt-build` first. Its exit code is `run_all.py`'s (1 on the first failing
  notebook), so the dashboard shows it as failed when a check fails.
- **`jupyter-lab`** runs
  `[...notebooks, "jupyter", "lab", "--no-browser", "--ip", "127.0.0.1", "--ServerApp.root_dir=analytics/notebooks", "--ServerApp.port_retries=0"]`
  with `.withHttpEndpoint({ env: "JUPYTER_PORT" })`.
  - **No wrapper script**: jupyter_server ≥ 2.0 (pulled in by `jupyterlab>=4.2`) reads its default
    port from the `JUPYTER_PORT` environment variable, which is exactly the variable Aspire's
    endpoint injects. Verify this in step 1; only if it doesn't hold, add
    `analytics/notebooks/lab.py` that execs `jupyter lab --port $JUPYTER_PORT …` (the fallback the
    issue allows).
  - `--ServerApp.root_dir` instead of the deprecated `--notebook-dir` alias (same effect; the
    kernel's working directory is then `analytics/notebooks/`, as with `run_all.py`, so the
    notebooks' relative `figures/` paths work).
  - `port_retries=0`: if Jupyter can't bind the Aspire-assigned port it must fail, not silently
    pick another port the dashboard link doesn't point to.
  - `--ip 127.0.0.1` keeps it on localhost; no `withExternalHttpEndpoints()`.
- **The kernel sees the database through inheritance**: the ipykernel process inherits the Jupyter
  server's environment, so `jassmin_ml/db.py` resolves `JASSMIN_SYNTH_URI` (key 2 of its order),
  and its `guard` still refuses anything but `jassmin_synth[_suffix]`. `db.py` also reads the repo
  `.env` but only for the fallback and the app-name guard; the injected variable wins.
- **Token**: see Q1. Default is a token, passed via the `JUPYTER_TOKEN` env var (jupyter_server
  reads it) from a generated, persisted secret parameter, with the dashboard URL carrying
  `?token=` if the SDK makes that easy **(unconfirmed)**.
- **No dashboard description field**: in the generated SDK `withDescription` exists only on
  parameters, not executables (`aspire-apphost/.aspire/modules/aspire.mts`), so the "run
  `synth-generate` and `dbt-build` first" hint lives in the `apphost.mts` comment and the docs, as
  it does for `dbt-build` today.
- No Vitest test: the AppHost has no tests today; it's checked by `pnpm aspire:build`
  (`tsc -p tsconfig.apphost.json`), Biome, and a manual `pnpm aspire run`. A Python test is added
  only if the `lab.py` fallback is needed.

## Open questions

- [ ] **Q1: Token or token-less JupyterLab?** — Why it matters: the issue accepts token-less on a
  local dashboard, but prefers a token if easy. A token means one more secret parameter
  (`jupyter-token`, `addParameterWithGeneratedValue(..., { secret: true, persist: true })`, the
  `cms-sync-secret` pattern) passed as `JUPYTER_TOKEN`, and the dashboard link must include
  `?token=…` (via `withUrlForEndpoint`/`withUrls`) or the developer copies it from the parameter or
  the logs. Recommended default: use the token; if the dashboard link can't carry it without
  awkward code, keep the token and say in the docs that the link opens Jupyter's login page and the
  token is shown under the `jupyter-token` parameter in the dashboard. Fall back to token-less
  (`--IdentityProvider.token=`) only if the token blocks the kernel/websocket through Aspire's
  proxy. Affects steps: 2.
- [ ] **Q2: Should `jupyter-lab` and `ml-notebooks` be allowed to run at the same time?** — Why it
  matters: both write the same `.ipynb` files in place (run_all saves outputs; JupyterLab saves on
  edit), so a save in one can clobber the other. Recommended default: no code guard, just a note in
  the docs ("don't run `ml-notebooks` while editing the notebooks in `jupyter-lab`"). Affects
  steps: 4.

## Resolved questions

- **Does the dashboard get a description for `ml-notebooks`?** — Not possible for executables:
  `withDescription` is only on `ParameterResource` in the SDK; the hint goes in the comment and
  docs, like `dbt-build` (source: `aspire-apphost/.aspire/modules/aspire.mts`, `apphost.mts`).
- **Do `run_all.py` and the kernel pick up `JASSMIN_SYNTH_URI`?** — Yes: `jassmin_ml/db.py`
  `URL_KEYS = ("WAREHOUSE_DATABASE_URL", "JASSMIN_SYNTH_URI", "SYNTH_DATABASE_URL")`, read from
  `os.environ`, which both the nbclient kernel and the JupyterLab kernel inherit; `guard()` still
  applies (source: `analytics/notebooks/jassmin_ml/db.py`, `run_all.py`).
- **Does a wrapper for the port need to exist?** — Not expected: jupyter_server 2 reads
  `JUPYTER_PORT`; verified in step 1 before relying on it (source: issue #159 Technical, which
  names that variable).
- **Are new Python dependencies needed?** — No, `jupyterlab>=4.2` is already in
  `analytics/notebooks/pyproject.toml` (#133).
- **Windows / Cyrillic paths** — `uv` already starts from Aspire in this checkout (`synth-generate`,
  `dbt-build`), and `run_all.py` already sets the selector event loop for pyzmq on Windows and was
  run under `C:\Users\КТС\…` for #133. Still checked manually for JupyterLab in step 5 (kernel
  connection files live in `%APPDATA%\jupyter\runtime`, also under the Cyrillic profile path).
- **Ignore files for JupyterLab** — `.ipynb_checkpoints/` and `/analytics/notebooks/.venv/` are
  already git-ignored (source: `.gitignore`).

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `aspire-apphost/apphost.mts` | Add `ml-notebooks` and `jupyter-lab` after `dbt-docs` (and `jupyter-token` if Q1 = token) |
| modify | `aspire-apphost/AGENTS.md` | Document both resources next to `dbt-build` / `dbt-docs` |
| modify | `analytics/notebooks/README.md` | "From the Aspire dashboard" next to the `uv` commands; run order; Q2 note |
| modify | `analytics/README.md` | Dashboard way and order in the case study's "Running it" |
| modify | `docs/setup.md` | One sentence in "Synthetic analytics data" naming `dbt-build` → `ml-notebooks` / `jupyter-lab` |
| create (fallback only) | `analytics/notebooks/lab.py` + `tests/test_lab.py` | Only if `JUPYTER_PORT` isn't read by jupyter_server |

## Steps

- [ ] **1. Verify the Jupyter CLI assumptions** — In the worktree run
  `uv sync --project analytics/notebooks`, then
  `JUPYTER_PORT=8899 uv run --project analytics/notebooks jupyter lab --no-browser --ip 127.0.0.1 --ServerApp.root_dir=analytics/notebooks --ServerApp.port_retries=0`
  and check the log says it listens on 8899 with root `analytics/notebooks`. Also check
  `JUPYTER_TOKEN=abc` sets the token. If `JUPYTER_PORT` is ignored, create `lab.py` (reads
  `JUPYTER_PORT`, appends `--port`, then calls `jupyterlab.labapp.main`) with a small pytest for
  the argument building, and point the resource at it instead.
- [ ] **2. Add the resources to `apphost.mts`** — After `dbt-docs`, a comment block (#159: what each
  does, "run `synth-generate` then `dbt-build` first", `db.py` refuses other databases, needs `uv`),
  `const notebooks = [...]`, then `ml-notebooks` and `jupyter-lab` with the wiring in *Decisions*.
  For Q1's token: `builder.addParameterWithGeneratedValue("jupyter-token", { minLength: 32,
  special: false }, { secret: true, persist: true })`, `.withEnvironment("JUPYTER_TOKEN", token)`,
  and try `withUrlForEndpoint("http", …)` to set the link to `/lab?token=…`; drop the link part if
  the callback can't resolve the secret value. Run `pnpm aspire:build` and `pnpm lint`.
- [ ] **3. Update `aspire-apphost/AGENTS.md`** — A bullet after `dbt-build` / `dbt-docs`:
  `ml-notebooks` / `jupyter-lab`, explicit-start children of `jassmin-synth` (#159,
  `addExecutable`, `uv` on the PATH), what each runs, `JUPYTER_PORT` from the `http` endpoint,
  localhost only, token handling, only `JASSMIN_SYNTH_URI`, run order, link to
  `analytics/notebooks/README.md`.
- [ ] **4. Update the analytics docs** — `analytics/notebooks/README.md` "Running it": a short
  "From the Aspire dashboard" paragraph (start `synth-generate`, then `dbt-build`, then
  `ml-notebooks`; `jupyter-lab` opens on its endpoint in `analytics/notebooks/`; the token; don't
  run both at once per Q2). `analytics/README.md` "Running it" (case study, ~line 279): one line
  that the same three steps are dashboard resources. `docs/setup.md` §Synthetic analytics data: one
  sentence naming the follow-on resources.
- [ ] **5. Manual run under Aspire (Windows)** — `pnpm aspire run`: both resources appear under
  `jassmin-synth`, not started. Start `synth-generate`, `dbt-build`, then `ml-notebooks`: all five
  notebooks report `ok` and it exits 0. Start `jupyter-lab`: the dashboard link opens JupyterLab
  on `analytics/notebooks/`, `netstat` shows it bound to `127.0.0.1` only, a cell
  `from jassmin_ml.db import read_mart; read_mart("select count(*) from marts.dim_customer")`
  (or any mart) works, and the resource's environment in the dashboard has no `JASSMINDB_URI`.
  Stop `jupyter-lab` and check no `jupyter`/kernel process is left behind. Revert the notebook
  outputs changed by the run if they differ only by the run (they should be byte-identical, #133).
- [ ] **6. Checks** — `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`; plus
  `uv run --project analytics/notebooks pytest analytics/notebooks` if `lab.py` was added.

## Testing & verification

- Automated: `pnpm aspire:build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`. Python
  test only for the `lab.py` fallback.
- Manual: step 5 (dashboard, headless run, JupyterLab endpoint, localhost binding, kernel reads
  `marts.*`, no `jassmindb` in env, clean shutdown on Windows).

## Acceptance criteria

- [ ] `ml-notebooks` and `jupyter-lab` appear under `jassmin-synth` in the Aspire dashboard and don't start on their own — steps 2, 5
- [ ] Starting `ml-notebooks` after `synth-generate` and `dbt-build` runs all notebooks against `jassmin_synth` and finishes successfully — steps 2, 5
- [ ] Starting `jupyter-lab` serves JupyterLab on its dashboard endpoint (localhost only), opened on `analytics/notebooks/`, with a kernel that can read `marts.*` — steps 1, 2, 5
- [ ] Neither resource gets `jassmindb` or the app's environment — steps 2, 5
- [ ] `aspire-apphost/AGENTS.md` and the analytics READMEs describe the resources and the run order — steps 3, 4
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass — step 6

## Out of scope

- Running the notebooks in CI (#133 Q4), a hosted/shared JupyterHub, scheduled retraining, the dbt
  `prod` target.
- Making `ml-notebooks` wait for `dbt-build` or chaining the three resources automatically.
- Any change to the notebooks, `run_all.py` or `jassmin_ml/` beyond the `lab.py` fallback.
