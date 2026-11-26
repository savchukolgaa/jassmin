"""scripts/nightly.sh (#183) with stub ``uv`` and ``pnpm``: a good night publishes the new build, a
failing one (a dbt test, say) keeps the previous site, and only the newest releases are kept.

Needs bash and flock (Linux; CI runs it). Skipped on Windows, where ``bash`` may be WSL's.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest

from wh import PROJECT_DIR

SCRIPT = PROJECT_DIR / "scripts" / "nightly.sh"

pytestmark = pytest.mark.skipif(
    os.name == "nt" or not shutil.which("bash") or not shutil.which("flock"),
    reason="needs bash and flock (Linux)",
)

STUB_UV = """#!/usr/bin/env bash
# Fails dbt when FAIL_DBT is set, as a failing data test would.
case "$*" in *wh.py*) [ -z "${FAIL_DBT:-}" ] || exit 1 ;; esac
echo "uv $*" >> "$STUB_LOG"
"""

STUB_PNPM = """#!/usr/bin/env bash
# `pnpm --dir <dashboard> run build:strict` writes a site that names the run.
echo "pnpm $*" >> "$STUB_LOG"
if [ "$4" = "build:strict" ]; then
  mkdir -p "$2/build" && echo "run $RUN_ID" > "$2/build/index.html"
fi
"""


def run(tmp: Path, run_id: str, stamp: str, *, fail_dbt: bool = False) -> subprocess.CompletedProcess[str]:
    env = {
        **os.environ,
        "PATH": f"{tmp / 'bin'}{os.pathsep}{os.environ['PATH']}",
        "REPO_ROOT": str(tmp / "repo"),
        "STATS_SITE_DIR": str(tmp / "site"),
        "STATS_KEEP_RELEASES": "2",
        "NIGHTLY_STAMP": stamp,
        "RUN_ID": run_id,
        "STUB_LOG": str(tmp / "stub.log"),
        "TMPDIR": str(tmp),
    }
    if fail_dbt:
        env["FAIL_DBT"] = "1"
    return subprocess.run(["bash", str(SCRIPT)], env=env, capture_output=True, text=True, check=False)


@pytest.fixture
def tmp(tmp_path: Path) -> Path:
    (tmp_path / "bin").mkdir()
    for name, body in (("uv", STUB_UV), ("pnpm", STUB_PNPM)):
        stub = tmp_path / "bin" / name
        stub.write_text(body, encoding="utf-8")
        stub.chmod(0o755)
    (tmp_path / "repo" / "analytics" / "dashboard").mkdir(parents=True)
    return tmp_path


def served(tmp: Path) -> str:
    return (tmp / "site" / "current" / "index.html").read_text(encoding="utf-8").strip()


def test_a_good_night_publishes_and_runs_every_stage_in_order(tmp: Path):
    result = run(tmp, "a", "20261126T010000Z")
    assert result.returncode == 0, result.stdout + result.stderr
    assert served(tmp) == "run a"
    assert os.readlink(tmp / "site" / "current") == "releases/20261126T010000Z"
    calls = (tmp / "stub.log").read_text(encoding="utf-8").splitlines()
    assert [c.split()[-1] for c in calls] == [
        f"{tmp / 'repo'}/analytics/warehouse/extract/extract.py",
        "prod",
        "sources",
        "build:strict",
    ]


def test_a_failing_dbt_test_keeps_the_previous_site(tmp: Path):
    assert run(tmp, "a", "20261126T010000Z").returncode == 0
    result = run(tmp, "b", "20261127T010000Z", fail_dbt=True)
    assert result.returncode != 0
    assert served(tmp) == "run a"
    assert sorted(p.name for p in (tmp / "site" / "releases").iterdir()) == ["20261126T010000Z"]


def test_only_the_newest_releases_are_kept(tmp: Path):
    for day, run_id in ((26, "a"), (27, "b"), (28, "c")):
        assert run(tmp, run_id, f"202611{day}T010000Z").returncode == 0
    assert served(tmp) == "run c"
    assert sorted(p.name for p in (tmp / "site" / "releases").iterdir()) == [
        "20261127T010000Z",
        "20261128T010000Z",
    ]
