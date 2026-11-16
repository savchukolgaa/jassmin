# ML notebooks (#133)

Five Jupyter notebooks on the warehouse marts (#132): an exploration and four models. The results
and what they mean for the shop are written up in the case study, [`../README.md`](../README.md).

| Notebook | What it does | Checks (asserted in its last cell) |
|----------|--------------|------------------------------------|
| `01_eda_rfm_cohorts` | RFM segments, cohort retention, STL seasonality, funnel by device and channel | December, February, March lead the seasonality |
| `02_ltv_bgnbd_gg` | MBG/NBD on a seasonally adjusted clock, Gamma-Gamma, 12-month CLV, ground-truth recovery | holdout total within 5 %, better than the calendar clock, segments above chance |
| `03_churn` | Logistic regression vs. LightGBM on a time split, calibration, SHAP, win-back list | LightGBM beats the baseline on PR-AUC |
| `04_recommendations` | Popularity, item-item cosine, implicit ALS; leave-last-out; position bias | a recommender beats popularity on Recall@10 |
| `05_demand_forecast` | Seasonal naive vs. LightGBM per bottle size, censored days masked, reorder points | LightGBM beats seasonal naive on WAPE in every origin |

It's a separate uv project (Python 3.12) with the ML stack: pandas, scikit-learn, LightGBM, shap,
pymc-marketing, implicit, statsmodels and Jupyter. The generator (`analytics/`) and the warehouse
(`analytics/warehouse/`) have their own.

## Running it

You need a PostgreSQL server with a generated and built `jassmin_synth` database:

```bash
# From the repo root.
uv run analytics/generator/generate.py --customers 10000               # #131, about 3 minutes
uv run --project analytics/warehouse analytics/warehouse/wh.py build   # #132, about 4 minutes
```

Then run all five notebooks top to bottom and save them with their outputs (about two minutes):

```bash
uv run --project analytics/notebooks analytics/notebooks/run_all.py          # all five
uv run --project analytics/notebooks analytics/notebooks/run_all.py 02 04    # some of them
```

`run_all.py` stops at the first failing notebook, and a notebook fails when its checks do. Or open
them in JupyterLab:

```bash
uv run --directory analytics/notebooks jupyter lab   # opens in the notebooks folder
```

**From the Aspire dashboard** (#159). Under `pnpm aspire run`, the whole pipeline is a set of
explicit-start children of `jassmin-synth`. Start them in this order, each after the previous one
has finished, because none waits for the one before:

1. `synth-generate`: generates the data (#131);
2. `dbt-build`: builds and tests the marts (#132);
3. `ml-notebooks`: runs `run_all.py` and fails if a notebook's checks do.

`jupyter-lab` serves JupyterLab on 127.0.0.1, opened on this folder. Open it with its
**JupyterLab** link in the dashboard, which carries the token; the plain endpoint link shows
Jupyter's login page, and the token is the `jupyter-token` parameter. Both resources get only
`JASSMIN_SYNTH_URI`. Don't start `ml-notebooks` while you're editing the notebooks in `jupyter-lab`:
both save the same `.ipynb` files, so one can overwrite the other's changes.

**Which database.** The same rules as `wh.py`: `WAREHOUSE_DATABASE_URL`, `JASSMIN_SYNTH_URI`,
`SYNTH_DATABASE_URL`, else the repo `.env`'s `DATABASE_URL` with the database name replaced by
`jassmin_synth`. `jassmin_ml/db.py` refuses any database that isn't `jassmin_synth[_suffix]`, and
opens every session read-only: the notebooks never write.

**Reproducibility.** Every random step uses the seed in `jassmin_ml/seed.py` (LightGBM runs in
deterministic mode, ALS on one thread), so two runs on the same data give byte-identical notebooks
and figures. The numbers in the notebooks and the case study are for the generator's default run
(`--customers 10000`, seed 42); other data gives other numbers, and the checks may fail on much
smaller runs. Without a C compiler PyTensor (used by pymc-marketing) runs in Python mode; the
notebooks set `PYTENSOR_FLAGS=cxx=` so it doesn't warn.

**Ground truth.** `raw.customer_truth` is read only by `jassmin_ml/truth.py`, in evaluation cells.
No model uses it as a feature.

## Layout

| Path | Content |
|------|---------|
| `0?_*.ipynb` | The notebooks, saved with outputs |
| `figures/` | One chart per notebook, written by the notebooks, used in the case study |
| `jassmin_ml/` | Helpers: `db` (guarded read-only access), `truth`, `clock` (seasonally adjusted time for BG/NBD), `metrics` (WAPE, Recall@k, NDCG@k, coverage, decile tables), `splits` (time split, leave-last-out, censoring), `plots`, `seed` |
| `tests/` | Unit tests of the helpers, without a database |
| `run_all.py` | Runs the notebooks in place |

## Tests

```bash
uv run --project analytics/notebooks pytest analytics/notebooks
```

CI runs these unit tests in the `analytics` job. It doesn't run the notebooks, which need the
generated database and its warehouse.
