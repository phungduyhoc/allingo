# syntax=docker/dockerfile:1.7
# hadolint global ignore=DL3018
# (DL3018: không ghim phiên bản apk vì Alpine xoá gói cũ khỏi mirror → build hỏng; image gốc node:22-alpine đã ghim)
# =============================================================================
# Allingo API + worker (NestJS/Fastify, ESM, build bằng tsc → dist/main.js | dist/worker.js)
#
# Build context = GỐC REPO (cần pnpm-lock.yaml, packages/*, db/):
#   docker build -f apps/api/Dockerfile -t ghcr.io/<owner>/allingo-api:dev .
#   docker build -f apps/api/Dockerfile --build-arg APP_ENTRY=dist/worker.js -t allingo-worker .
# Một image dùng cho cả api và worker: Container Apps ghi đè `args` (= CMD) thành `node dist/worker.js`
# và đặt env APP_ENTRY=dist/worker.js, giữ ENTRYPOINT tini (xem infra/terraform/modules/compute).
# Job migrate dùng cùng image với `args` = `node migrate.mjs`. ARG APP_ENTRY chỉ để chạy local/compose.
#
# Giai đoạn: base → deps (pnpm fetch + install --offline, cache store) → build (tsc, pnpm deploy --prod)
#            → runtime (node:22-alpine, non-root, chỉ node_modules prod + dist + migrations)
# =============================================================================
ARG NODE_VERSION=22.23.4
ARG PNPM_VERSION=10.28.0

# ---------- base -------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    npm_config_store_dir=/pnpm/store \
    CI=true
# Ghim đúng phiên bản packageManager của repo
# Cài pnpm qua npm thay vì corepack: corepack đi kèm image node có thể mang khoá ký npm cũ → "Cannot find matching keyid"
RUN npm install -g "pnpm@${PNPM_VERSION}" && pnpm --version
WORKDIR /repo

# ---------- deps -------------------------------------------------------------
FROM base AS deps
# argon2 0.45 có prebuild linux-x64 musl (prebuilds/linux-x64/argon2.musl.node) nên thường không cần
# biên dịch; python3/make/g++ là dự phòng khi prebuild không khớp (vd. arm/v7) – chỉ ở stage build.
RUN apk add --no-cache python3 make g++ libc6-compat
# 1) chỉ lockfile → `pnpm fetch` tải toàn bộ tarball vào store; layer này chỉ đổi khi lockfile đổi
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN --mount=type=cache,id=allingo-pnpm-store,target=/pnpm/store \
    pnpm fetch
# 2) manifest của mọi workspace package (để lockfile khớp importers) rồi install offline, chỉ nhánh api
COPY package.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/cms/package.json apps/cms/
COPY db/package.json db/
COPY packages/api-client/package.json packages/api-client/
COPY packages/config/package.json packages/config/
COPY packages/fsrs/package.json packages/fsrs/
COPY packages/planner/package.json packages/planner/
COPY packages/i18n/package.json packages/i18n/
COPY packages/schemas/package.json packages/schemas/
COPY packages/scoring/package.json packages/scoring/
COPY packages/ui/package.json packages/ui/
RUN --mount=type=cache,id=allingo-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --offline --filter "@allingo/api..."

# ---------- build ------------------------------------------------------------
FROM deps AS build
# Nguồn của api và các workspace package nó import từ dist (schemas, fsrs, planner, scoring, db) + config tsconfig
COPY packages/config packages/config
COPY packages/schemas packages/schemas
COPY packages/fsrs packages/fsrs
COPY packages/planner packages/planner
COPY packages/scoring packages/scoring
COPY db db
COPY apps/api apps/api
# pnpm chạy `build` theo thứ tự topo: schemas → fsrs/scoring/db → api (tsc -p tsconfig.build.json → apps/api/dist)
RUN pnpm --filter "@allingo/api..." run build
# Gói riêng api + dependency production (workspace package được copy theo `files: ["dist"]`)
RUN --mount=type=cache,id=allingo-pnpm-store,target=/pnpm/store \
    pnpm --filter @allingo/api deploy --prod --legacy /out \
    && rm -rf /out/src /out/test /out/scripts /out/eslint.config.js /out/vitest.config.ts /out/tsconfig*.json

# ---------- runtime ----------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS runtime
# Vá gói hệ điều hành của base image (Trivy chặn CRITICAL/HIGH – vd. openssl, musl, zlib) giữa các bản node mới; runtime chỉ cần
# `node` nên gỡ npm/corepack/yarn đi kèm image (mang dependency bị CVE, không dùng khi chạy – payload migrate chạy từ máy có pnpm)
RUN apk upgrade --no-cache \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-* \
       /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
ARG APP_ENTRY=dist/main.js
ENV NODE_ENV=production \
    APP_ENV=production \
    APP_ENTRY=${APP_ENTRY} \
    API_PORT=4000 \
    API_HOST=0.0.0.0 \
    TZ=Asia/Ho_Chi_Minh \
    NODE_OPTIONS=--enable-source-maps
# tini: PID 1 chuyển SIGTERM cho node (graceful shutdown của Nest/BullMQ); tzdata cho TZ;
# ffmpeg (+ffprobe): job media.process và TTS mock (ADR-0025) – cùng image cho API và worker
RUN apk add --no-cache tini tzdata libc6-compat ffmpeg
WORKDIR /app
COPY --from=build --chown=node:node /out/package.json ./package.json
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/dist ./dist
# Migration SQL + script chạy migration bằng dependency production (Container Apps Job `migrate`)
COPY --chown=node:node db/drizzle/migrations ./db/drizzle/migrations
COPY --chown=node:node infra/docker/migrate.mjs ./migrate.mjs
USER node
EXPOSE 4000
# Worker không có HTTP: healthcheck bỏ qua khi APP_ENTRY là worker (ACA dùng probe riêng, không đọc HEALTHCHECK)
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD [ "$APP_ENTRY" = "dist/worker.js" ] || wget -qO- "http://127.0.0.1:${API_PORT}/v1/health/live" > /dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
# `exec` để node thay thế shell và nhận tín hiệu trực tiếp từ tini
CMD ["sh", "-c", "exec node ${APP_ENTRY}"]
