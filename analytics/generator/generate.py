# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "numpy>=2.1",
#     "psycopg[binary]>=3.2",
#     "tzdata>=2024.1",
# ]
# ///
"""Synthetic data generator for the Jassmin perfume shop (#131).

Simulates customers with latent behaviour (BG/NBD-style purchase rate and churn), their visits
and #129 analytics events, carts (abandoned ones too), orders with the full Ukrainian e-commerce
lifecycle (card or cash on delivery, Nova Poshta parcels never collected), the shop's discount
rules, card payment attempts, and an inventory ledger with restocks and stock-outs, with Ukrainian
seasonality and deliberate data-quality anomalies.

It loads everything into `raw.*` of a separate `jassmin_synth` database (never the app's), with
the app's migrations applied, and with `--load-app-schema` also into its `public` tables.

    uv run analytics/generator/generate.py --customers 10000
    uv run analytics/generator/generate.py --customers 300 --out out --no-db

See analytics/README.md for the customer model and the anomaly catalogue.
"""

from __future__ import annotations

import argparse
import sys
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import anomalies  # noqa: E402
import config  # noqa: E402
import frames  # noqa: E402
from simulate import Output, simulate  # noqa: E402


@dataclass
class Generated:
    output: Output
    #: The raw layer: the simulation's tables with the anomalies, as CSV text per table.
    raw: dict[str, str]
    #: The clean ledger and final stock, for the app schema (`--load-app-schema`).
    clean_inventory: str
    clean_variants: str


def generate(customers: int, visitors: int, start: datetime, end: datetime, seed: int) -> Generated:
    output = simulate(customers, visitors, start, end, seed)
    tables = anomalies.inject(output, seed, start, end)
    tables["customer_truth"] = output.customer_truth
    raw = {name: frames.render(name, tables[name]) for name in frames.TABLE_ORDER}
    clean_variants = [
        {**row, "stock_quantity": output.clean_stock.get(row["id"], 0)}
        for row in output.tables["product_variants"]
    ]
    return Generated(
        output=output,
        raw=raw,
        clean_inventory=frames.render("inventory_movements", output.clean_inventory),
        clean_variants=frames.render("product_variants", clean_variants),
    )


def parse_day(value: str) -> datetime:
    return datetime.fromisoformat(value).replace(tzinfo=config.KYIV)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--customers", type=int, default=10_000, help="registered customers")
    ap.add_argument("--visitors", type=int, default=15_000, help="anonymous visitors who never register")
    ap.add_argument("--start", type=parse_day, default=parse_day("2024-01-01"), help="first day (Kyiv)")
    ap.add_argument("--end", type=parse_day, default=parse_day("2026-11-01"), help="day after the last (Kyiv)")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--load-app-schema", action="store_true",
                    help="also load the rows that pass the app's constraints into public.*")  # fmt: skip
    ap.add_argument("--out", type=Path, help="also write one CSV per table to this directory")
    ap.add_argument("--no-db", action="store_true", help="don't touch any database")
    ap.add_argument("--database-name", default="jassmin_synth",
                    help="target database (must be jassmin_synth or jassmin_synth_<suffix>)")  # fmt: skip
    args = ap.parse_args(argv)
    if args.end <= args.start:
        ap.error("--end must be after --start")

    target = None
    if not args.no_db:
        import db  # psycopg is only needed with a database

        target = db.resolve_target(args.database_name)  # refuses anything but a synth database
        print(f"Target database: {db.redact(target)}")

    began = time.monotonic()
    generated = generate(args.customers, args.visitors, args.start, args.end, args.seed)
    print(f"Generated in {time.monotonic() - began:.1f}s (digest {frames.digest(generated.raw)[:12]}).")
    for name in frames.TABLE_ORDER:
        print(f"  raw.{name:24s} {generated.raw[name].count(chr(10)):>9,d} rows")

    if args.out:
        args.out.mkdir(parents=True, exist_ok=True)
        for name, payload in generated.raw.items():
            (args.out / f"{name}.csv").write_text(payload, encoding="utf-8", newline="\n")
        print(f"Wrote {len(generated.raw)} CSV files to {args.out}.")

    if target is not None:
        import db

        db.load(target, generated, args, load_app_schema=args.load_app_schema)
    return 0


if __name__ == "__main__":
    sys.exit(main())
