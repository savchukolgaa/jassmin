"""Run the #133 notebooks top to bottom, in place, and save them with their outputs.

    uv run --project analytics/notebooks analytics/notebooks/run_all.py          # all five
    uv run --project analytics/notebooks analytics/notebooks/run_all.py 02 04    # some of them

Each notebook ends with a "Checks" cell that asserts its acceptance criterion, so a model that
misses its target fails the run. Stops at the first failing notebook (it's still saved, with the
error, so you can see where). Needs a generated and built ``jassmin_synth`` (see README.md).
"""

from __future__ import annotations

import asyncio
import sys
import time
from pathlib import Path

import nbformat
from nbclient import NotebookClient
from nbclient.exceptions import CellExecutionError

HERE = Path(__file__).resolve().parent
#: Longest a single cell may run, in seconds (the LTV fit is the slowest).
CELL_TIMEOUT = 1200


def notebooks(selected: list[str]) -> list[Path]:
    paths = sorted(HERE.glob("[0-9][0-9]_*.ipynb"))
    if not selected:
        return paths
    chosen = [p for p in paths if any(p.name.startswith(s) for s in selected)]
    if len(chosen) != len(selected):
        raise SystemExit(f"run_all.py: unknown notebook in {selected}; have {[p.name for p in paths]}")
    return chosen


def run(path: Path) -> bool:
    nb = nbformat.read(path, as_version=4)
    client = NotebookClient(
        nb,
        timeout=CELL_TIMEOUT,
        kernel_name="python3",
        resources={"metadata": {"path": str(HERE)}},
        record_timing=False,
    )
    started = time.perf_counter()
    try:
        client.execute()
        ok = True
    except CellExecutionError as error:
        print(error, file=sys.stderr)
        ok = False
    nbformat.write(nb, path)
    status = "ok" if ok else "FAILED"
    print(f"{path.name}: {status} in {time.perf_counter() - started:.0f} s", flush=True)
    return ok


def main(argv: list[str]) -> int:
    if sys.platform == "win32":
        # pyzmq needs a selector event loop; the default Proactor loop only works with a warning.
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    for path in notebooks(argv):
        if not run(path):
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
