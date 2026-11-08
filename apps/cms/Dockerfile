# syntax=docker/dockerfile:1.7
# hadolint global ignore=DL3018
# (DL3018: không ghim phiên bản apk vì Alpine xoá gói cũ khỏi mirror → build hỏng; image gốc node:22-alpine đã ghim)
# =============================================================================
# Allingo CMS (Payload CMS 3 trên Next.js 16, cổng 3001)
#
# Build context = GỐC REPO:
#   docker build -f apps/cms/Dockerfile -t ghcr.io/<owner>/allingo-cms:dev .
#
# GHI CHÚ QUAN TRỌNG
# 1. apps/cms/next.config.ts CHƯA bật `output: 'standalone'` (ngoài phạm vi Sprint 1 infra) → image này đóng gói
#    kiểu "next start": .next + node_modules production (pnpm deploy --prod). Image lớn hơn standalone (~2–3x);
#    khi thêm `output: 'standalone'` vào apps/cms/next.config.ts thì chuyển stage runtime sang mẫu của apps/web.
# 2. `next build` của Payload nạp payload.config.ts → cần PAYLOAD_SECRET và (theo CI hiện tại) DATABASE_URL trỏ tới
#    Postgres có schema `cms` để adapter đọc schema. Giá trị build-arg mặc định dưới đây là giả; khi build thật:
#      - local: `docker build --network=host --build-arg DATABASE_URL=postgres://allingo:allingo@127.0.0.1:5432/allingo ...`
#      - CI (deploy-staging.yml): service postgres + buildx network=host.
#    Secret build-arg KHÔNG được lưu vào image: chỉ dùng ở stage build (stage runtime không ENV lại).
# 3. importMap.js (src/app/(payload)/admin/importMap.js) đã commit; nếu đổi component admin, chạy
#    `pnpm --filter @allingo/cms generate:importmap` trước khi build.
# =============================================================================
ARG NODE_VERSION=22.12.0
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
# sharp có prebuild musl; build tools dự phòng cho argon2 (dependency của @allingo/db)
RUN apk add --no-cache python3 make g++ libc6-compat
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
COPY packages/i18n/package.json packages/i18n/
COPY packages/schemas/package.json packages/schemas/
COPY packages/scoring/package.json packages/scoring/
COPY packages/ui/package.json packages/ui/
RUN --mount=type=cache,id=allingo-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --offline --filter "@allingo/cms..."

# ---------- build ------------------------------------------------------------
FROM deps AS build
# Chỉ dùng lúc build (xem ghi chú 2); không ENV ở stage runtime
ARG DATABASE_URL=postgres://allingo:allingo@127.0.0.1:5432/allingo
ARG PAYLOAD_SECRET=build-only-payload-secret-not-used-at-runtime
ARG CMS_PUBLIC_URL=http://localhost:3001
ENV DATABASE_URL=${DATABASE_URL} \
    PAYLOAD_SECRET=${PAYLOAD_SECRET} \
    CMS_PUBLIC_URL=${CMS_PUBLIC_URL} \
    CMS_DATABASE_SCHEMA=cms \
    NODE_ENV=production
COPY packages/config packages/config
COPY packages/schemas packages/schemas
COPY db db
COPY apps/cms apps/cms
# Thứ tự topo: schemas → db (tsc) → cms (next build với withPayload)
RUN pnpm --filter "@allingo/cms..." run build \
    && test -f apps/cms/.next/BUILD_ID
# Gói cms + dependency production; giữ .next, next.config.ts, package.json; bỏ nguồn/test/mẫu.
# `pnpm deploy` chọn tệp theo quy tắc packlist (tôn trọng apps/cms/.gitignore, vốn bỏ `.next/`)
# → copy lại .next tường minh, nếu không image runtime không có bản build và `next start` lỗi.
RUN --mount=type=cache,id=allingo-pnpm-store,target=/pnpm/store \
    pnpm --filter @allingo/cms deploy --prod --legacy /out \
    && rm -rf /out/.next && cp -R apps/cms/.next /out/.next \
    && test -f /out/.next/BUILD_ID \
    && rm -rf /out/.next/cache /out/src /out/test /out/scripts /out/samples /out/docs /out/media \
              /out/eslint.config.js /out/vitest.config.ts /out/tsconfig*.json /out/AGENTS.md /out/README.md

# ---------- runtime ----------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    CMS_PORT=3001 \
    HOSTNAME=0.0.0.0 \
    CMS_MEDIA_DIR=/app/media \
    TZ=Asia/Ho_Chi_Minh
RUN apk add --no-cache tini tzdata libc6-compat \
    && mkdir -p /app/media && chown node:node /app/media
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3001
# Volume cho upload (Azure Files trên Container Apps); image không giữ media
VOLUME ["/app/media"]
# Payload admin redirect /admin → /admin/login (3xx) khi chưa đăng nhập; wget mặc định theo redirect
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${CMS_PORT}/admin/login" > /dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "exec node node_modules/next/dist/bin/next start -p ${CMS_PORT} -H ${HOSTNAME}"]
