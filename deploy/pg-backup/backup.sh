#!/usr/bin/env bash
# Dumps every database in BACKUP_DATABASES (custom format, for pg_restore) into /backups as
# <db>-<UTC timestamp>.dump, then deletes dumps older than BACKUP_KEEP_DAYS (default 7).
# Connection: PGHOST, PGPORT, PGUSER, PGPASSWORD from the environment. See docs/deploy.md.
# jassmin_wh, the owner's dashboard warehouse (#183), is deliberately not in BACKUP_DATABASES: it's
# a copy of jassmindb, rebuilt every night.
set -euo pipefail

dir=/backups
keep_days="${BACKUP_KEEP_DAYS:-7}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"

for db in ${BACKUP_DATABASES:-jassmindb strapidb}; do
  file="$dir/$db-$stamp.dump"
  pg_dump --format=custom --no-owner --dbname="$db" --file="$file.partial"
  mv "$file.partial" "$file"
  echo "backup: wrote $file ($(du -h "$file" | cut -f1))"
done

find "$dir" -maxdepth 1 -name '*.dump' -mtime "+$keep_days" -print -delete \
  | sed 's/^/backup: deleted /'
