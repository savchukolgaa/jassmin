# Plan: Train LTV, churn, recommendation and demand-forecast models and write the portfolio case study (#133)

Issue: https://github.com/savchukolgaa/jassmin/issues/133
Branch: `issue/133`
Worktree: `.claude/worktrees/issue-133`
Status: Planned

## Goal

As a data analyst building a portfolio, I want LTV, churn, recommendation and demand-forecasting
models trained on the warehouse marts, with a written case study, so that I can show end-to-end data
work from the app's event tracking to business decisions. This adds `analytics/notebooks/` with one
EDA notebook and four reproducible models on the #132 marts (BG/NBD + Gamma-Gamma LTV, churn
classification, item-to-item recommendations, per-size demand forecasting), each checked against the
generator's planted ground truth or a baseline, and turns `analytics/README.md` into a portfolio
case study.

## Dependencies & prerequisites

- **#131 generator** (merged, `analytics/generator/`): writes `raw.*`, including
  `raw.customer_truth` (segment, purchase_rate, churn_probability, favourite_family, usual_device,
  acquisition_channel, churned_at), to `jassmin_synth`. Default run: seed 42, 10,000 customers,
  2024-01-01 → 2026-11-01.
- **#132 warehouse** (merged, `analytics/warehouse/`): builds `marts.*` in `jassmin_synth`:
  `dim_date`, `dim_products`, `dim_customers`, `fct_orders`, `fct_order_items`, `fct_sessions`,
  `fct_events`, `fct_inventory_daily`, `mart_customer_features`.
- **#129 event properties** (`list_id`, `list_position`, `price`, `in_stock`, `dwell_ms` as typed
  columns of `fct_events`) and **#130 inventory ledger** (`fct_inventory_daily.is_demand_censored`):
  both merged.
- To run the notebooks you need a PostgreSQL server with a generated and built `jassmin_synth`:
  `uv run analytics/generator/generate.py --customers 10000` then
  `uv run --project analytics/warehouse analytics/warehouse/wh.py build` (or `synth-generate` then
  `dbt-build` in Aspire). It wasn't running while this plan was written, so the data facts below
  come from the READMEs, not from queries.
- New Python packages (a new uv project, see Decisions): pandas, numpy, scipy, SQLAlchemy +
  psycopg, matplotlib, seaborn, statsmodels (STL), scikit-learn, LightGBM, shap,
  pymc-marketing **(unconfirmed, Q1)**, implicit, jupyter/ipykernel, nbclient/nbformat, pytest.
  No npm packages, no migrations, no env vars beyond the existing database ones.

## Decisions & assumptions

1. **A third uv project, `analytics/notebooks/`** (`pyproject.toml`, `uv.lock`, `.python-version`
   = 3.12), next to `analytics/` (generator) and `analytics/warehouse/` (dbt), as #132 did. The ML
   stack (LightGBM, shap/numba, pymc/pytensor, implicit) is heavy; keeping it out of
   `analytics/pyproject.toml` keeps the generator's CI job fast and its lockfile small. "From a
   clean `uv sync`" becomes `uv sync --project analytics/notebooks`.
2. **A small helper package `analytics/notebooks/jassmin_ml/`** holds everything that isn't a story
   cell, so it can be unit-tested and the notebooks stay readable:
   - `db.py`: resolves the database like `wh.py` (`WAREHOUSE_DATABASE_URL`, `JASSMIN_SYNTH_URI`,
     `SYNTH_DATABASE_URL`, else the repo `.env`'s `DATABASE_URL` with the name replaced by
     `jassmin_synth`) and applies the same guard (`jassmin_synth[_suffix]` only, never the app's
     database). It opens the session **read-only** (`default_transaction_read_only = on`) and
     exposes `read_mart(sql) -> pandas.DataFrame`. It copies `wh.py`'s ~40 lines instead of
     importing across uv projects; a test pins the behaviour.
   - `truth.py`: `load_truth()` reads `raw.customer_truth` and adds
     `customer_key = md5('u:' || user_id)` (the `customer_key` macro in
     `analytics/warehouse/macros/keys.sql`). It's only called in evaluation cells, never to build
     features, matching #131's "evaluate against it, never train on it".
   - `metrics.py`: `wape`, `recall_at_k`, `ndcg_at_k`, `catalog_coverage`, `decile_table`.
   - `splits.py`: `time_split` (by snapshot date), `leave_last_out`, `censor_mask`.
   - `plots.py`: one matplotlib style for every chart, and `save_figure(fig, name)` writing PNGs
     to `analytics/notebooks/figures/` for the README.
   - `seed.py`: `SEED = 133` and `set_seeds()` (numpy, `random`, `PYTHONHASHSEED` note).
3. **Notebooks run top to bottom and assert their own acceptance criterion** in a final
   "Checks" cell (e.g. `assert pr_auc_lgbm > pr_auc_logit`), so a failing criterion fails the run.
   They're saved **with outputs** (the issue requires it), executed by
   `analytics/notebooks/run_all.py` (nbclient, in place, 20-min timeout per notebook, kernel
   `python3` of the project's venv). Outputs are deterministic up to timings: fixed seeds,
   `deterministic=True` / `num_threads=1` where a library is otherwise non-deterministic.
4. **Data window and time unit.** The data spans 2024-01-01 → 2026-11-01 (Kyiv days). Every split is
   by time, using Kyiv dates from the marts (`order_date`, `snapshot_date`, `day`). A "purchase" is
   a revenue order: `fct_orders.is_revenue` (paid, shipped or completed; payment-failed
   cancellations excluded), as in `mart_customer_features`.
5. **LTV (02).** Transactions = revenue orders per `customer_key` by `order_date` (one per day,
   like `lifetimes`' `summary_data_from_transaction_data`), monetary = `net_revenue`, time unit
   = weeks. Calibration 2024-01-01 → 2025-11-01, holdout 2025-11-01 → 2026-11-01 (12 months, so
   it includes a full December and 8 March). Fit BG/NBD on the calibration RFM; Gamma-Gamma on
   repeat customers after checking the frequency–monetary correlation is weak. Then refit on the
   full period for 12-month CLV per customer (monthly discount rate 1 %, a stated assumption) and
   aggregate by `dim_customers.acquisition_channel`.
   - **Holdout check:** customers ranked into deciles by predicted holdout purchases; per decile
     |predicted − actual| / actual ≤ 15 % **(unconfirmed, Q2)** for low deciles.
   - **Ground truth:** Spearman ρ between the posterior expected rate (λ̂, from the conditional
     expected purchases) and `customer_truth.purchase_rate`; mean λ̂ and mean P(alive) per true
     segment vs. the generator's 6.0 / 3.0 / 1.3 / 0.6 orders a year; and 4 clusters
     (k-means on log λ̂ and P(alive) at the end of calibration) vs. the true segment, scored with
     adjusted Rand index and accuracy after Hungarian matching, against a permutation baseline
     ("above chance" = ARI > 0 with p < 0.01 and accuracy above the 35 % majority-class rate).
   - Caveat for the write-up: the generator's churn is drawn *after each order*, which is exactly
     BG/NBD's dropout assumption, so BG/NBD is well specified here; real data won't be.
6. **Churn (03).** Train on `marts.mart_customer_features` where `is_label_available`, label
   `churned_next_90d`. Features: every point-in-time column of the mart (`tenure_days`,
   `recency_days`, `frequency`, `monetary`, `avg_order_value`, `discount_share`, `orders_placed`,
   `return_rate`, `unclaimed_rate`, `sessions_30d`, `sessions_90d`, `days_since_last_visit`,
   `is_registered`), plus calendar month of the snapshot and only the **time-invariant** columns of
   `dim_customers` (`acquisition_channel`, `first_touch_source`, `city`, `is_registered`).
   `dim_customers`' lifetime aggregates (`order_count`, `lifetime_net_revenue`, `last_order_at`,
   device shares, `primary_device`, `favourite_family`) are computed over the whole history and
   would leak the future, so they're excluded; the notebook says why.
   - Time-based split by `snapshot_date`: train ≤ 2025-08-01, validation 2025-09-01 → 2025-12-01,
     test 2026-01-01 → the last labelled snapshot (2026-08-01). Each customer appears in several
     monthly rows; splitting by time (not customer) is the honest production setup and is stated.
   - Models: logistic regression (standardised, one-hot, `class_weight=None`) vs. LightGBM (early
     stopping on validation). Metrics on test: ROC-AUC, PR-AUC (positive = churn, base rate
     ≈ 86 %, so the notebook also reports PR-AUC for the *retained* class, which is the harder and
     more informative one), Brier score, reliability curve; isotonic calibration on validation if
     LightGBM is miscalibrated. SHAP (`TreeExplainer`): beeswarm summary + one dependence plot
     (recency).
   - **Business cut-off:** at the latest snapshot, the top risk decile among customers with
     *some* chance of staying (excluding P(churn) > 0.98 lost causes) ranked by
     `P(churn) × expected 90-day revenue` (AOV × expected orders); expected saved revenue
     = Σ P(churn) × value × uplift − promo cost, with uplift 10 % and a 15 % discount promo on one
     order **(unconfirmed, Q3)**.
7. **Recommendations (04).** Items are perfumes (`product_key`, 128 + unknown `-1`, which is
   dropped), not sizes. Users are `customer_key` (logged-in events and orders; anonymous sessions
   feed only the co-view matrix via `session_id`). Implicit-feedback weights: purchase 5,
   add_to_cart 3, product_view 1 (dwell ≥ 10 s +1). **Leave-last-out:** for each customer with ≥ 2
   distinct purchased perfumes, the last purchased perfume is the target, and training uses only
   interactions *before the session of that purchase* (so its own pre-purchase views don't leak
   it). Models: popularity (revenue-order counts in the training window), item-item cosine on
   co-purchase + co-view (session-level), and implicit ALS (`implicit.als`, `random_state=SEED`,
   `num_threads=1`, factors/regularisation tuned on a validation fold carved the same way one step
   earlier). Metrics: Recall@10, NDCG@10, catalog coverage@10. Already-interacted items are **not**
   filtered (repeat purchases of a favourite are real behaviour). Position-bias note: CTR-like
   view share by `list_position` for `list_id = 'popular'` and the catalog lists, showing the
   popularity baseline partly measures the shop's own ranking; IPS weighting is described, not
   built.
8. **Demand forecast (05).** Series = tracked sizes (30/50/100 ml) from
   `marts.fct_inventory_daily`, target `units_sold` per Kyiv day. Days with
   `is_demand_censored` are **masked**: excluded from training rows and from WAPE, and lag features
   that would read a censored day are NaN (LightGBM handles missing). Models: seasonal-naive
   (same weekday last week, falling back to two weeks back when that day is censored) vs. one
   global LightGBM (Tweedie objective for intermittent counts) with calendar features from
   `dim_date` (weekday, month, `is_womens_day`, `is_valentines_day`, `is_st_nicholas_day`,
   `is_new_year`, `is_black_friday`, `is_gift_season`), lags 7/14/28 and rolling means, size,
   `dim_products.popular_rank`, gender and family. Test = the last 13 weeks (2026-08-03 →
   2026-11-01), rolling-origin backtest with 3 origins for robustness. Report WAPE overall
   (Σ|e| / Σ actual over non-censored days), per variant (top 20 by volume in a table) and weekly
   WAPE as a secondary view since daily sales per size are mostly 0. **Reorder point:**
   ROP = forecast demand over the lead time + z·σ·√L, with lead time 5–21 days (the generator's
   supplier delay, so mean 13 days) and 95 % service level; compared with the shop's current
   implicit rule (reorder at ≤ 1 unit).
9. **EDA (01).** RFM segments (quintile scores on `mart_customer_features`' last snapshot), a
   monthly cohort retention heatmap (first-order month × months since), STL decomposition of daily
   revenue orders with 8 March / December annotated, and the session funnel (viewed → cart →
   checkout → purchased from `fct_sessions`) by `device_type` and `traffic_source`.
10. **README structure.** The issue puts the case study in `analytics/README.md`, and seven files
    link to that README for the generator (`AGENTS.md`, `README.md`, `docs/setup.md`,
    `aspire-apphost/AGENTS.md`, the warehouse README, `_sources.yml`, `generator/*.py`). So the
    case study goes **at the top** of `analytics/README.md`, and the existing generator docs stay
    below under "Synthetic data (#131)" with their headings unchanged, so no link breaks.
    Diagrams are Mermaid (GitHub renders them): a flowchart for the architecture and an
    `erDiagram` for the star schema. Each model section embeds one PNG from
    `analytics/notebooks/figures/`. Numbers quoted in the README are the seed-42 default run's.
11. **CI.** CI can't afford generate (≈ 3 min) + dbt build (≈ 3 min) + five notebooks within the
    analytics job's 15 minutes reliably, so CI runs only the `jassmin_ml` unit tests
    **(unconfirmed, Q4)**: a new step `uv run --project analytics/notebooks --locked pytest
    analytics/notebooks` in the existing `analytics` job (its path filter already covers
    `analytics/**`). Notebook execution is a documented local command.
12. **Repo tooling.** Biome and `tsc` already ignore `analytics/`. Add
    `/analytics/notebooks/.venv/` and `.ipynb_checkpoints/` to `.gitignore`, and
    `*.ipynb linguist-generated` plus `*.png binary` to `.gitattributes` so PR diffs stay readable.

## Open questions

- [ ] **Q1: Which BG/NBD / Gamma-Gamma library: `pymc-marketing` or `lifetimes`?** — Why it
  matters: `lifetimes` (named first in the issue) has had no release since 2020 and breaks on
  current pandas/NumPy 2 in places; `pymc-marketing` is its maintained successor (same
  `BetaGeoModel` / `GammaGammaModel`, MAP or full Bayesian fit) but pulls in PyMC/PyTensor, which on
  Windows without a C compiler runs in slow Python mode (fine for a MAP fit on ~8,000 customers).
  Recommended default: `pymc-marketing` with `fit(method="map")`, plus a short full-MCMC section
  only if it runs in under ~5 minutes. Affects steps: 1, 4.
- [ ] **Q2: How to read "within 15 % of actual purchases per decile" for the low deciles?** — Why
  it matters: the bottom predicted deciles hold one-time buyers with near-zero holdout purchases,
  so a relative error there can exceed 15 % on a handful of orders even when the model is right.
  Recommended default: assert ≤ 15 % on every decile; if the bottom deciles fail only because
  their actual count is tiny (< 30 orders), merge them into one "bottom 30 %" bucket, say so in the
  notebook and README, and assert on that. Affects steps: 4.
- [ ] **Q3: Win-back economics.** — Why it matters: expected saved revenue needs an uplift rate and
  a promo cost, which the data can't tell us (there's no experiment). Recommended default: 10 %
  uplift and a 15 %-off promo on the next order, shown as a sensitivity table (5 / 10 / 20 % uplift)
  so the reader sees the assumption. Affects steps: 5.
- [ ] **Q4: Should CI execute the notebooks?** — Why it matters: a full run needs the generator,
  the dbt build and ~10–20 min of notebooks, which doesn't fit the 15-minute analytics job;
  running on a smaller dataset (e.g. 1,000 customers) would make the asserted thresholds flaky.
  Recommended default: CI runs only the `jassmin_ml` unit tests; notebooks are run locally with
  `run_all.py` and committed with outputs. Affects steps: 2, 9.
- [ ] **Q5: Add an Aspire resource for the notebooks?** — Why it matters: `synth-generate` and
  `dbt-build` are Aspire children of `jassmin-synth`; a `jupyter-lab` / `ml-notebooks` child would
  make the whole pipeline startable from the dashboard, at the cost of Aspire wiring in this
  issue. Recommended default: no; document the `uv` commands only, and leave it for a later issue.
  Affects steps: 9.

## Resolved questions

- **Where do features come from, and can notebooks read the app's database?** — Only `marts.*` in
  `jassmin_synth`; BI and ML never read the app's tables (source: `AGENTS.md` → Commands,
  `analytics/warehouse/README.md`). `jassmin_ml/db.py` reuses `wh.py`'s resolution and guard.
- **How to join the ground truth to the marts?** — `customer_key = md5('u:' || user_id)` for
  registered users (source: `analytics/warehouse/macros/keys.sql`); `raw.customer_truth` has
  `user_id, segment, purchase_rate, churn_probability, favourite_family, usual_device,
  acquisition_channel, churned_at` (source: `analytics/generator/frames.py`). Use only for
  evaluation (source: `analytics/README.md`, `_sources.yml`).
- **What are the planted segments and rates to recover?** — loyal 8 % / 6.0 a year / churn 0.06,
  regular 22 % / 3.0 / 0.18, occasional 35 % / 1.3 / 0.40, one_time 35 % / 0.6 / 0.85; individual
  rates Gamma(shape 2) around the segment mean, Poisson purchases, churn after each order (source:
  `analytics/README.md`, `analytics/generator/config.py`).
- **Is the churn label already point-in-time?** — Yes: `mart_customer_features` reads only data
  before `snapshot_at`, tested by `assert_features_point_in_time` and
  `assert_features_match_history_before_snapshot`; the label is null without 90 days of data
  (`is_label_available`); ~102,500 rows, 33 snapshots, ~86 % churn (source:
  `analytics/warehouse/README.md`, `models/marts/ml/_ml__models.yml`).
- **Which series are "full-bottle variants", and where is censoring?** — Only 30/50/100 ml track
  stock; `fct_inventory_daily` is size × Kyiv day with `is_stock_out` and `is_demand_censored`
  (source: `analytics/README.md` → raw tables, `models/marts/inventory/_inventory__models.yml`).
  Out-of-stock shoppers mostly switch to 10 ml (untracked), so masked days really are censored.
- **Supplier lead time for the reorder point?** — 5–21 days after stock drops to ≤ 1 unit (source:
  `analytics/README.md` → Inventory).
- **Which dim_customers columns are safe for the churn model?** — Only time-invariant ones; the
  lifetime aggregates cover the whole history (source: `models/marts/core/_core__models.yml`
  column list), so they would leak.
- **Python version and tooling isolation?** — 3.12 like the other two projects; Biome
  (`biome.json` `!analytics`) and `tsc` (`tsconfig.json` exclude) already ignore `analytics/`.
- **Does CI already watch `analytics/**`?** — Yes, the `analytics` job's path filter
  (`.github/workflows/ci.yml`, `docs/ci.md`).

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `analytics/notebooks/pyproject.toml`, `uv.lock`, `.python-version` | The ML uv project (Python 3.12, pinned ranges) |
| create | `analytics/notebooks/jassmin_ml/__init__.py` | Helper package |
| create | `analytics/notebooks/jassmin_ml/db.py` | Read-only, guarded connection to `jassmin_synth`; `read_mart()` |
| create | `analytics/notebooks/jassmin_ml/truth.py` | `load_truth()` with `customer_key` (evaluation only) |
| create | `analytics/notebooks/jassmin_ml/metrics.py` | WAPE, Recall@k, NDCG@k, coverage, decile table |
| create | `analytics/notebooks/jassmin_ml/splits.py` | Time split, leave-last-out, censor mask |
| create | `analytics/notebooks/jassmin_ml/plots.py` | Chart style, `save_figure()` |
| create | `analytics/notebooks/jassmin_ml/seed.py` | `SEED`, `set_seeds()` |
| create | `analytics/notebooks/tests/test_db.py`, `test_metrics.py`, `test_splits.py`, `test_truth.py` | Unit tests (no database) |
| create | `analytics/notebooks/run_all.py` | Executes the five notebooks in place with nbclient; non-zero exit on failure |
| create | `analytics/notebooks/01_eda_rfm_cohorts.ipynb` | RFM, cohorts, seasonality, funnel |
| create | `analytics/notebooks/02_ltv_bgnbd_gg.ipynb` | BG/NBD + Gamma-Gamma, holdout, CLV, ground truth |
| create | `analytics/notebooks/03_churn.ipynb` | Logistic vs. LightGBM, calibration, SHAP, win-back list |
| create | `analytics/notebooks/04_recommendations.ipynb` | Popularity, item-item, ALS; leave-last-out; position bias |
| create | `analytics/notebooks/05_demand_forecast.ipynb` | Seasonal-naive vs. LightGBM, censoring, WAPE, reorder point |
| create | `analytics/notebooks/figures/*.png` | One chart per notebook for the README |
| create | `analytics/notebooks/README.md` | How to run (sync, prerequisites, `run_all.py`, Jupyter) |
| modify | `analytics/README.md` | Portfolio case study at the top; generator docs kept below |
| modify | `.gitignore`, `.gitattributes` | Notebook venv/checkpoints; `*.ipynb linguist-generated`, `*.png binary` |
| modify | `.github/workflows/ci.yml`, `docs/ci.md` | Unit-test step for `analytics/notebooks` |
| modify | `AGENTS.md` | One line: `analytics/notebooks/` uv project, models read only `marts` |

## Steps

- [ ] **1. Scaffold the uv project and check the stack installs.** Create
  `analytics/notebooks/pyproject.toml` (`package = false`, `requires-python = ">=3.12,<3.13"`,
  dependencies above, dev group `pytest`; `[tool.pytest.ini_options] testpaths = ["tests"]`,
  `pythonpath = ["."]`), `.python-version`, and run `uv sync --project analytics/notebooks` on
  Windows. Verify that `lightgbm`, `shap`, `implicit` and `pymc_marketing` import, and that a
  10-customer BG/NBD MAP fit runs (Q1). If `implicit` has no Windows wheel for the resolved
  version, pin the last version that does; if `pymc-marketing` is impractical, fall back to
  `lifetimes` and note it. Update `.gitignore` / `.gitattributes`.
- [ ] **2. `jassmin_ml` helpers with tests.** Write `db.py` (resolution + guard + read-only session),
  `truth.py`, `metrics.py`, `splits.py`, `plots.py`, `seed.py`. Tests: the guard refuses
  `jassmindb` / the app's database / any non-`jassmin_synth` name and accepts
  `jassmin_synth_test`; `wape` on a hand example and with masked days; `recall_at_k` / `ndcg_at_k`
  on a toy ranking (NDCG of a perfect ranking = 1); `leave_last_out` keeps only interactions before
  the target's session; `censor_mask` makes lags reading a censored day NaN; `customer_key`
  matches `md5('u:' || id)`. Add the CI step and `docs/ci.md` row. Check:
  `uv run --project analytics/notebooks pytest analytics/notebooks`.
- [ ] **3. `01_eda_rfm_cohorts.ipynb`.** Load marts via `read_mart`, RFM quintiles and segment
  table, cohort retention heatmap, STL on daily orders (annotate 8 March and December peaks and
  the summer dip, compare with the generator's multipliers), funnel by device and by traffic
  source. Save `figures/01_cohort_retention.png`. Checks cell: seasonality peak in March and
  December present.
- [ ] **4. `02_ltv_bgnbd_gg.ipynb`.** RFM summary in weeks for calibration/holdout, fit BG/NBD,
  decile table of predicted vs. actual holdout purchases (`figures/02_holdout_deciles.png`),
  Gamma-Gamma on repeat buyers (+ correlation check), 12-month CLV per customer and per
  acquisition channel, ground-truth comparison (Spearman ρ, per-segment means, k-means 4 clusters
  vs. truth: ARI, matched accuracy, permutation baseline). Checks cell: decile errors ≤ 15 %
  (Q2), ARI > permutation 99th percentile, accuracy > 0.35.
- [ ] **5. `03_churn.ipynb`.** Build the feature frame (Decision 6), time split, logistic baseline
  and LightGBM, ROC-AUC/PR-AUC (both classes)/Brier on test, reliability curves (calibrate if
  needed), SHAP beeswarm + recency dependence (`figures/03_shap_summary.png`), win-back list at the
  latest snapshot with the saved-revenue sensitivity table (Q3). Checks cell: LightGBM PR-AUC >
  logistic PR-AUC on test.
- [ ] **6. `04_recommendations.ipynb`.** Build the interaction table, leave-last-out split (and the
  validation fold for ALS tuning), popularity / item-item / ALS, Recall@10, NDCG@10, coverage@10
  table (`figures/04_recall_at_10.png`), position-bias chart by `list_position`. Optional extra
  cut: Recall@10 by true `favourite_family` match, showing the models learnt the planted taste.
  Checks cell: item-item and ALS Recall@10 > popularity (at least the best model must beat it).
- [ ] **7. `05_demand_forecast.ipynb`.** Daily panel per tracked size, censoring share, seasonal-naive
  with censored fallback, global LightGBM (Tweedie), rolling-origin backtest, overall / per-variant
  / weekly WAPE on non-censored days (`figures/05_forecast_vs_actual.png` for one popular size),
  reorder points for the top sizes vs. the ≤ 1-unit rule. Checks cell: LightGBM WAPE <
  seasonal-naive WAPE overall, and no censored day in the evaluation set.
- [ ] **8. `run_all.py` and a clean run.** Implement the runner (executes 01–05 in order, in place,
  stops at the first failure, prints each notebook's wall time). Against a fresh seed-42 default
  `jassmin_synth`: `uv sync --project analytics/notebooks` from a removed `.venv`, then
  `uv run --project analytics/notebooks analytics/notebooks/run_all.py`. Run it twice and check
  that the metrics in the outputs are identical (determinism). Commit notebooks with outputs and
  the figures.
- [ ] **9. Write the case study and docs.** Top of `analytics/README.md`: the problem; architecture
  Mermaid flowchart (app → `user_events`/OLTP → `raw` → dbt staging → intermediate → marts →
  notebooks); star-schema `erDiagram` (facts `fct_orders`, `fct_order_items`, `fct_sessions`,
  `fct_events`, `fct_inventory_daily` around `dim_customers`, `dim_products`, `dim_date`, plus
  `mart_customer_features`); data-quality story (#131 anomaly catalogue → #132 staging handling →
  dbt tests, in a short table linking the warehouse README); one section per model with its chart,
  headline metric vs. baseline, and one business action; limitations (synthetic data, BG/NBD
  well specified by construction, no experiment for uplift, what changes with real data: sparser
  history, real seasonality, cold start, need for a holdout test of the win-back promo). Use the
  issue's terms (event-driven behavioural tracking, OLTP vs. analytical layer, medallion/layered
  ELT, point-in-time feature engineering, data contracts and data tests, censored demand,
  probabilistic CLV, model calibration). Write `analytics/notebooks/README.md` (how to run), add the
  line to `AGENTS.md`.
- [ ] **10. Final checks.** `uv run --project analytics/notebooks --locked pytest analytics/notebooks`,
  `uv run --project analytics --locked pytest analytics` (unchanged generator still green),
  `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` (repo rule before finishing an issue).

## Testing & verification

- **Unit tests** (`analytics/notebooks/tests/`, no database): guard and URL resolution, metrics on
  hand-computed examples, leave-last-out leakage rule, censor mask, `customer_key` hashing.
- **End-to-end**: `run_all.py` against seed-42 `jassmin_synth`; every notebook's Checks cell
  asserts its acceptance criterion. Second run gives identical metrics.
- **Clean environment**: delete `analytics/notebooks/.venv`, `uv sync --project analytics/notebooks
  --locked`, run again.
- **Repo commands**: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` (nothing in the app
  changes, but the repo rule applies), plus both existing Python test suites.
- **Manual**: open the README on GitHub (branch view) to check Mermaid diagrams and images render.

## Acceptance criteria

- [ ] All five notebooks run end to end from a clean environment against `jassmin_synth` — steps 1, 3–8
- [ ] BG/NBD holdout predictions are within 15% of actual purchases per decile, and the recovered segments match the generator's ground truth above chance — step 4 (Q2)
- [ ] The churn model beats the logistic baseline on PR-AUC with a time-based split, and SHAP plots are included — step 5
- [ ] The recommender beats the popularity baseline on Recall@10 — step 6
- [ ] The forecast beats the seasonal-naive baseline on WAPE, with stock-out days masked — step 7
- [ ] `analytics/README.md` presents the architecture, data quality work and results as a portfolio case study — step 9

## Out of scope

- Serving recommendations or any model on the site, and writing predictions back to a database
  (the notebooks only read).
- Dashboards / BI tools.
- Changes to the generator or the dbt models (if a mart turns out to lack something, note it as a
  follow-up issue instead of widening this one).
- An Aspire resource for Jupyter (Q5) and CI execution of the notebooks (Q4).
- Running on the `prod` target / real data.
