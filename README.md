# Allingo — Ngoại ngữ cho tất cả

Nền tảng luyện thi bằng AI cho TOEIC, IELTS, JLPT, HSK (thị trường Việt Nam): làm đề đúng định dạng thi, AI giải thích song ngữ, chấm Writing/Speaking theo rubric, shadowing, từ vựng FSRS, lộ trình thích ứng, gói Free/Pro, B2B cho trường/trung tâm.

Monorepo Turborepo + pnpm, TypeScript strict. Quy tắc làm việc bắt buộc ở [`CLAUDE.md`](./CLAUDE.md); nguồn sự thật ở [`docs/spec/`](./docs/spec/); quyết định kiến trúc ở [`docs/adr/`](./docs/adr/README.md).

## Chạy trong 5 phút

Yêu cầu: Node 22 LTS (≥ 22.12), pnpm 10 (`corepack enable`), Docker (Postgres 16 + pgvector, Valkey, Meilisearch, Mailpit; dev lưu tệp bằng driver `fs` – MinIO ngừng phát hành image 09/2026, S143), ffmpeg/ffprobe (sinh audio Listening). Windows: chạy trong WSL2 (Ubuntu), đặt mã nguồn trong thư mục nhà của Ubuntu (không đặt trong `/mnt/c`).

```bash
pnpm i
cp .env.example .env                 # giá trị mặc định chạy được ngay ở dev (AI_PROVIDER=mock, không cần API key)
pnpm docker:up                       # postgres :5432, redis :6379, meilisearch :7700, mailpit :8025 (S3 cục bộ: --profile s3, S143)
pnpm --filter './packages/*' --filter @allingo/db build   # build gói dùng chung + @allingo/db (API/seed đọc bản dist)
pnpm db:migrate                      # migration 0001 = DDL docs/spec/allingo-schema.sql (97 bảng, 6 schema)
pnpm db:seed --set core,demo         # core: programs/sections/question_types/roles/plans/quotas/prompts; demo: 224 câu TOEIC (3 đề full, 5 mini, 7 drill, 1 chẩn đoán) + tài khoản mẫu
pnpm --filter @allingo/api seed:media   # sinh audio Listening + ảnh Part 1 (TTS mock = im lặng đúng thời lượng; giọng Azure khi có AZURE_SPEECH_KEY)
pnpm dev                             # web :3000 · api :4000 (Swagger /docs) · cms :3001/admin · worker
```

Tài khoản demo (mật khẩu `Allingo@2026`): web `learner_free@allingo.dev`, `learner_pro@allingo.dev`; CMS `admin@allingo.dev`, `teacher@allingo.dev`, `editor@allingo.dev` (chạy `pnpm --filter @allingo/cms exec tsx scripts/seed-cms.ts` một lần).

Không cần API cũng xem được web: `pnpm --filter @allingo/web dev:mock` (fetch giả lập bám hợp đồng OpenAPI).

## Kiểm tra chất lượng

```bash
pnpm lint && pnpm typecheck && pnpm test     # turbo: eslint (boundaries module), tsc, vitest (unit + integration Postgres/Redis)
pnpm db:diff                                 # migration & Drizzle schema so với docs/spec/allingo-schema.sql
pnpm api:openapi && pnpm api:diff            # OpenAPI xuất từ NestJS so với docs/spec/allingo-openapi.yaml
pnpm client:gen                              # sinh lại kiểu cho packages/api-client khi spec đổi
pnpm test:e2e                                # Playwright luồng khách (mock); E2E_REAL_API=1 để chạy với API thật
pnpm eval:build && pnpm eval:run             # Promptfoo (cần API key)
```

Definition of Done cho mỗi task: `CLAUDE.md` §8.

## Bố cục

```
apps/web        Next.js 16 App Router, next-intl, Tailwind 4, TanStack Query, PWA           → apps/web/README.md
apps/api        NestJS 12 trên Fastify: iam, catalog, test-engine, learning, billing, ai-gateway… + worker BullMQ
apps/cms        Payload CMS 3 (schema `cms`), phát hành sang catalog qua API nội bộ          → apps/cms/README.md
packages/       schemas (Zod, nguồn sự thật kiểu), api-client (openapi-fetch + hooks), ui, i18n, scoring (quy đổi điểm, chẩn đoán thích ứng),
                planner (PlanGenerator lộ trình thuần – S9, ADR-0032), fsrs, config (ESLint/TS + bảng gating entitlements.ts, XP xp.ts)
db/             Drizzle schema 6 schema, migrations, seed core/demo, db:diff
docs/           spec (DDL, OpenAPI, prompts, promptfoo), adr, prompts (master/sprint), ASSUMPTIONS, SPEC-ISSUES, HANDOFF, VERSIONS, LICENSES
infra/          docker compose dev, terraform (khung), .github/workflows (CI: lint/typecheck/unit, integration+diff+build, e2e, security)
```

Trạng thái: **Sprint 0 hoàn thành** (walking skeleton: khách → đề mini TOEIC Part 5/Part 2 → nộp → kết quả → xem lại → giải thích AI mock → đăng ký ghép tiến độ; CMS soạn & phát hành). Chi tiết bàn giao, việc còn lại và rủi ro: [`docs/HANDOFF.md`](./docs/HANDOFF.md).
