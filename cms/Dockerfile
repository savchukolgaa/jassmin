# syntax=docker/dockerfile:1
# Strapi for production (#176), built from the REPO ROOT context, because `cms` is a package of the
# root pnpm workspace and shares its lockfile:
#   docker build -f cms/Dockerfile .
# Built by `pnpm aspire deploy` (aspire-apphost/production.mts). Its secrets come from the
# environment at runtime (see docs/deploy.md); uploads go on a volume at /app/cms/public/uploads.

ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-bookworm-slim AS build
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
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter jassmin-cms
COPY cms/ cms/
# Strapi loads its config while building the admin panel, so it needs placeholder secrets here
# (like CI); the real ones come from the environment at runtime and never reach the image.
RUN NODE_ENV=production \
    APP_KEYS=build-key-1,build-key-2 \
    API_TOKEN_SALT=build \
    ADMIN_JWT_SECRET=build \
    TRANSFER_TOKEN_SALT=build \
    JWT_SECRET=build \
    ENCRYPTION_KEY=build \
    pnpm --filter jassmin-cms build

FROM node:${NODE_VERSION}-bookworm-slim AS cms
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=1337
WORKDIR /app
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /app/cms/public/uploads && chown node:node /app/cms/public/uploads
USER node
WORKDIR /app/cms
EXPOSE 1337
CMD ["node_modules/.bin/strapi", "start"]
