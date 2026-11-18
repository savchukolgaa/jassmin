# syntax=docker/dockerfile:1
# The shop's images for production (#176). Built by `pnpm aspire deploy` (aspire-apphost/production.mts):
#   --target web   the React Router server (`react-router-serve`), production dependencies only.
#   --target jobs  the full install and the source, for `pnpm db:migrate` and the scheduled jobs
#                  (they're `tsx`/`drizzle-kit` scripts, both dev dependencies), run by supercronic.
# See docs/deploy.md.

ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-bookworm-slim AS base
# pnpm comes from Corepack at package.json's `packageManager` version. The global virtual store
# (pnpm-workspace.yaml) is off, so node_modules is self-contained and can be copied between stages.
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    pnpm_config_enable_global_virtual_store=false
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY cms/package.json cms/
RUN corepack install

# Every dependency of the app (not Strapi's): the build and the jobs need the dev dependencies.
FROM base AS deps
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter jassmin

FROM base AS prod-deps
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter jassmin

FROM deps AS build
COPY . .
RUN pnpm build

FROM node:${NODE_VERSION}-bookworm-slim AS web
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app
COPY --from=prod-deps /app/node_modules node_modules
COPY package.json ./
COPY --from=build /app/build build
USER node
EXPOSE 3000
CMD ["node_modules/.bin/react-router-serve", "./build/server/index.js"]

FROM deps AS jobs
ARG SUPERCRONIC_VERSION=v0.2.33
ARG TARGETARCH=amd64
ADD --chmod=755 https://github.com/aptible/supercronic/releases/download/${SUPERCRONIC_VERSION}/supercronic-linux-${TARGETARCH} /usr/local/bin/supercronic
ENV NODE_ENV=production
COPY . .
# Corepack keeps pnpm in the user's cache, so install it for `node` before dropping root.
RUN mkdir -p /home/node/.cache && cp -r /root/.cache/node /home/node/.cache/ \
    && chown -R node:node /home/node/.cache
USER node
CMD ["supercronic", "-passthrough-logs", "/app/deploy/crontab"]
