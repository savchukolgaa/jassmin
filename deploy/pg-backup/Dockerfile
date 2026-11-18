# Nightly dumps of both databases (#176): `pg_dump -Fc` of jassmindb and strapidb into /backups
# (bind-mounted from /srv/jassmin/backups on the server), kept 7 days. Same major version as the
# `postgres` service. Run once by hand: `docker compose exec pg-backup backup.sh`.
FROM postgres:18-bookworm
ARG SUPERCRONIC_VERSION=v0.2.33
ARG TARGETARCH=amd64
ADD --chmod=755 https://github.com/aptible/supercronic/releases/download/${SUPERCRONIC_VERSION}/supercronic-linux-${TARGETARCH} /usr/local/bin/supercronic
COPY --chmod=755 backup.sh /usr/local/bin/backup.sh
COPY crontab /etc/pg-backup/crontab
ENTRYPOINT []
# The absolute path: as PID 1 supercronic re-executes itself by the name it was started with.
CMD ["/usr/local/bin/supercronic", "-passthrough-logs", "/etc/pg-backup/crontab"]
