# syntax=docker/dockerfile:1
# The owner's dashboard pipeline in production (#183): the warehouse (Python, uv, dbt) and the
# Evidence site (Node, pnpm), run by supercronic. Built from the repo root with its own
# Dockerfile.dockerignore (the root .dockerignore leaves analytics/ out). Two services use it
# (aspire-apphost/production.mts):
#   analytics-setup  once per deploy: extract/setup.py creates jassmin_wh, the roles and the grants;
#   analytics        supercronic with deploy/analytics/crontab: scripts/nightly.sh every night.
# See docs/deploy.md and analytics/warehouse/README.md → Real data.

ARG NODE_VERSION=24

FROM ghcr.io/astral-sh/uv:0.13.7 AS uv

FROM node:${NODE_VERSION}-bookworm-slim
ARG SUPERCRONIC_VERSION=v0.2.33
ARG TARGETARCH=amd64
# CA certificates: dbt's packages download over HTTPS while they install. (flock, which nightly.sh
# uses, is in util-linux, already in the image.)
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ADD --chmod=755 https://github.com/aptible/supercronic/releases/download/${SUPERCRONIC_VERSION}/supercronic-linux-${TARGETARCH} /usr/local/bin/supercronic
COPY --from=uv /uv /uvx /usr/local/bin/

# uv installs the Python of analytics/warehouse/.python-version into /opt/python, readable by `node`.
# pnpm comes from Corepack at the dashboard's `packageManager` version, kept in /opt/corepack.
ENV UV_PYTHON_INSTALL_DIR=/opt/python \
    UV_LINK_MODE=copy \
    UV_NO_CACHE=1 \
    COREPACK_HOME=/opt/corepack \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    CI=true \
    SEND_ANONYMOUS_USAGE_STATS=no
RUN corepack enable
WORKDIR /app

# The warehouse's locked dependencies, without the dev group (pytest).
COPY analytics/warehouse/pyproject.toml analytics/warehouse/uv.lock analytics/warehouse/.python-version analytics/warehouse/
RUN uv sync --project analytics/warehouse --frozen --no-dev

# The dashboard's own pnpm workspace (Evidence).
COPY analytics/dashboard/package.json analytics/dashboard/pnpm-lock.yaml analytics/dashboard/pnpm-workspace.yaml analytics/dashboard/
RUN cd analytics/dashboard && corepack install && pnpm install --frozen-lockfile

COPY analytics/warehouse analytics/warehouse
COPY analytics/dashboard analytics/dashboard
# dbt_utils, pinned in package-lock.yml; installed now so the nightly run needs no download.
RUN cd analytics/warehouse && uv run --frozen --no-dev dbt deps --project-dir . --profiles-dir .
COPY deploy/analytics/crontab /etc/analytics/crontab

# dbt writes target/ and logs/, Evidence .evidence/ and build/; the site goes to /srv/stats (a volume
# that Caddy mounts read-only).
RUN mkdir -p /srv/stats && chown -R node:node /app/analytics /srv/stats /opt/corepack
USER node
# The absolute path: as PID 1 supercronic re-executes itself by the name it was started with.
CMD ["/usr/local/bin/supercronic", "-passthrough-logs", "/etc/analytics/crontab"]
