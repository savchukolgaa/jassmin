#!/usr/bin/env bash
# The owner's dashboard, rebuilt every night (#183), in the `analytics` container
# (deploy/analytics/crontab):
#
#   1. extract    copy the shop's data, read-only and pseudonymised, into jassmin_wh.raw
#   2. dbt        build and test raw -> staging -> marts (`wh.py build --target prod`)
#   3. evidence   query the marts and build the static site
#   4. publish    switch the served site to the new build, atomically
#
# Any failure (a dbt test included) stops the run before step 4, so the site keeps the previous
# build; every page shows the data's date and warns when it's older than 36 hours. Run it by hand:
# `docker compose exec analytics /app/analytics/warehouse/scripts/nightly.sh` (docs/deploy.md).
#
# Environment: WH_EXTRACT_URL, WH_TARGET_URL and WH_PSEUDONYM_KEY (extract/extract.py);
# EVIDENCE_SOURCE__warehouse__* (analytics/dashboard/README.md); STATS_SITE_DIR, where the site is
# served from (default /srv/stats: releases/<UTC stamp> and the `current` symlink); and
# STATS_KEEP_RELEASES (default 3). NIGHTLY_STAMP overrides the release name (tests).
set -euo pipefail

repo="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}"
site_dir="${STATS_SITE_DIR:-/srv/stats}"
keep="${STATS_KEEP_RELEASES:-3}"
stamp="${NIGHTLY_STAMP:-$(date -u +%Y%m%dT%H%M%SZ)}"
export WAREHOUSE_PROD_URL="${WAREHOUSE_PROD_URL:-${WH_TARGET_URL:-}}"
export SEND_ANONYMOUS_USAGE_STATS=no

log() { echo "nightly: $(date -u +%H:%M:%S) $*"; }

# One run at a time: a slow night must not overlap the next one.
exec 9>"${TMPDIR:-/tmp}/jassmin-nightly.lock"
if ! flock -n 9; then
  log "another run is still going; skipping"
  exit 0
fi

started=$SECONDS
log "1/4 extract"
uv run --project "$repo/analytics/warehouse" --frozen "$repo/analytics/warehouse/extract/extract.py"

log "2/4 dbt build --target prod"
uv run --project "$repo/analytics/warehouse" --frozen "$repo/analytics/warehouse/wh.py" build --target prod

log "3/4 evidence sources and build"
pnpm --dir "$repo/analytics/dashboard" run sources
pnpm --dir "$repo/analytics/dashboard" run build:strict

log "4/4 publish"
mkdir -p "$site_dir/releases"
release="$site_dir/releases/$stamp"
cp -R "$repo/analytics/dashboard/build" "$release.partial"
mv "$release.partial" "$release"
# A relative link, so it resolves wherever the volume is mounted (Caddy mounts it read-only).
ln -sfn "releases/$stamp" "$site_dir/current.next"
mv -T "$site_dir/current.next" "$site_dir/current"

# Keep the newest releases (the current one is the newest), and no half-copied leftovers.
find "$site_dir/releases" -mindepth 1 -maxdepth 1 -name '*.partial' -exec rm -rf {} +
find "$site_dir/releases" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -r \
  | tail -n "+$((keep + 1))" | while read -r old; do rm -rf "${site_dir:?}/releases/$old"; done

log "published $stamp in $((SECONDS - started))s"
