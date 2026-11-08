# syntax=docker/dockerfile:1.7
# hadolint global ignore=DL3018
# (DL3018: không ghim phiên bản apk vì Alpine xoá gói cũ khỏi mirror → build hỏng; image gốc node:22-alpine đã ghim)
# =============================================================================
# Allingo Web (Next.js 16 App Router, output: 'standalone', PWA service worker đóng gói bằng esbuild ở prebuild)
#
# Build context = GỐC REPO:
#   docker build -f apps/web/Dockerfile \
#     --build-arg NEXT_PUBLIC_API_URL=https://api.staging.allingo.vn/v1 \
#     --build-arg NEXT_PUBLIC_APP_URL=https://staging.allingo.vn \
#     -t ghcr.io/<owner>/allingo-web:dev .
#
# Lưu ý: NEXT_PUBLIC_* được Next inline lúc build → mỗi môi trường build một image riêng (tag theo env),
# hoặc chấp nhận cùng giá trị cho dev/staging. Image không chứa secret.
# =============================================================================
ARG NODE_VERSION=22.23.4
ARG PNPM_VERSION=10.28.0

# ---------- base -------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    npm_config_store_dir=/pnpm/store \
    CI=true \
    NEXT_TELEMETRY_DISABLED=1
# Cài pnpm qua npm thay vì corepack: corepack đi kèm image node có thể mang khoá ký npm cũ → "Cannot find matching keyid"
RUN npm install -g "pnpm@${PNPM_VERSION}" && pnpm --version
WORKDIR /repo

# ---------- deps -------------------------------------------------------------
FROM base AS deps
RUN apk add --no-cache libc6-compat
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN --mount=type=cache,id=allingo-pnpm-store,target=/pnpm/store \
    pnpm fetch
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
    pnpm install --frozen-lockfile --offline --filter "@allingo/web..."

# ---------- build ------------------------------------------------------------
FROM deps AS build
ARG NEXT_PUBLIC_API_URL=http://localhost:4000/v1
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ARG NEXT_PUBLIC_DEFAULT_LOCALE=vi
ARG NEXT_PUBLIC_POSTHOG_KEY=
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY=
ARG SW_BUILD_ID=
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
    NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL} \
    NEXT_PUBLIC_DEFAULT_LOCALE=${NEXT_PUBLIC_DEFAULT_LOCALE} \
    NEXT_PUBLIC_POSTHOG_KEY=${NEXT_PUBLIC_POSTHOG_KEY} \
    NEXT_PUBLIC_TURNSTILE_SITE_KEY=${NEXT_PUBLIC_TURNSTILE_SITE_KEY} \
    SW_BUILD_ID=${SW_BUILD_ID} \
    NODE_ENV=production
# packages/api-client `prebuild` sinh types từ docs/spec/allingo-openapi.yaml
COPY docs/spec/allingo-openapi.yaml docs/spec/allingo-openapi.yaml
COPY packages/config packages/config
COPY packages/schemas packages/schemas
COPY packages/scoring packages/scoring
COPY packages/i18n packages/i18n
COPY packages/ui packages/ui
COPY packages/api-client packages/api-client
COPY apps/web apps/web
# Thứ tự topo: schemas/scoring/i18n/api-client (tsup) → web (prebuild sw → next build, Turbopack)
RUN pnpm --filter "@allingo/web..." run build \
    && test -f apps/web/.next/standalone/apps/web/server.js

# ---------- runtime ----------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS runtime
# Vá gói hệ điều hành của base image (Trivy chặn CRITICAL/HIGH – vd. openssl, musl, zlib) giữa các bản node mới
RUN apk upgrade --no-cache
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    TZ=Asia/Ho_Chi_Minh
RUN apk add --no-cache tini tzdata libc6-compat
WORKDIR /app
# standalone giữ cấu trúc monorepo: /app/apps/web/server.js + /app/node_modules (đã trace)
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
# Chưa có route /api/health: dùng /manifest.webmanifest (sinh tĩnh từ app/manifest.ts, không qua proxy next-intl,
# không gọi API) để health của web không phụ thuộc API; cùng đường dẫn với readiness probe trên Container Apps.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/manifest.webmanifest" > /dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/web/server.js"]
