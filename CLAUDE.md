# CLAUDE.md — Allingo monorepo

Tệp này là chỉ dẫn thường trực cho Claude Code khi làm việc trong repo `allingo`. Đọc toàn bộ trước khi sửa bất kỳ tệp nào. Khi một yêu cầu mâu thuẫn với tệp này, hỏi lại trước khi làm.

## 1. Sản phẩm trong một đoạn

Allingo ("Ngoại ngữ cho tất cả") là nền tảng luyện thi bằng AI cho TOEIC, IELTS, JLPT và HSK, thị trường Việt Nam: làm đề đúng định dạng thi, AI giải thích song ngữ từng câu, AI chấm Writing/Speaking theo rubric giám khảo, shadowing & chấm phát âm, từ vựng FSRS, lộ trình thích ứng đến ngày thi, gói Free/Pro bán trên web (VNPay/MoMo/ZaloPay), B2B cho trường/trung tâm. Tài liệu nguồn nằm trong `docs/spec/`.

## 2. Nguồn sự thật (đọc theo thứ tự khi cần)

| Tệp | Vai trò | Quy tắc |
| --- | --- | --- |
| `docs/spec/allingo-schema.sql` | DDL PostgreSQL tham chiếu: 6 schema (`iam`, `catalog`, `learn`, `ai`, `billing`, `ops`), 97 bảng, partition, RLS, seed tối thiểu | Drizzle schema trong `db/drizzle/schema/` phải tương đương; CI so khớp bằng `pnpm db:diff`. Không đổi tên bảng/cột trong DDL mà không cập nhật tài liệu |
| `docs/spec/allingo-openapi.yaml` | Hợp đồng API v1 (100 đường dẫn) | NestJS xuất OpenAPI từ code; CI `pnpm api:diff` không được lệch. Thêm endpoint = sửa YAML trước, code sau |
| `docs/spec/allingo-prompts.yaml` | 14 prompt version v1 cho AI Gateway, JSON Schema đầu ra, model policy, ngưỡng eval | Seed vào `ai.prompt_templates/prompt_versions/model_routes`; Zod ở `packages/schemas/src/ai/` sinh từ các JSON Schema này |
| `docs/spec/allingo-promptfoo.yaml` | Cấu hình eval AI | `pnpm eval:*` |
| `docs/spec/technical-design.md`, `docs/spec/prd.md` | Thiết kế kỹ thuật & PRD (xuất từ Claude Docs) | Tham chiếu khi cần ngữ cảnh; ADR trong `docs/adr/` |

## 3. Stack & phiên bản

TypeScript strict toàn repo. Node LTS hiện hành, pnpm 10, Turborepo. Phiên bản chính xác ghi ở `docs/VERSIONS.md` (cập nhật khi nâng cấp).

| Lớp | Công nghệ |
| --- | --- |
| Web | Next.js (App Router, RSC), Tailwind CSS, shadcn/ui, next-intl (vi/en/ja/ko/th), TanStack Query, PWA (Serwist) |
| API | NestJS trên Fastify, Zod validation (`nestjs-zod` hoặc pipe tự viết), Drizzle ORM, BullMQ, Socket.IO, pino, OpenTelemetry |
| Worker | Cùng codebase `apps/api`, entry `src/worker.ts`, processors BullMQ |
| CMS | Payload CMS (Next.js), dùng chung PostgreSQL schema `cms` |
| Data | PostgreSQL 16+ với `pgvector`, `citext`, `pg_trgm`; Redis/Valkey; S3-compatible (MinIO dev); Meilisearch |
| AI | Vercel AI SDK (`ai`, `@ai-sdk/google`, `@ai-sdk/anthropic`, `@ai-sdk/openai`) sau lớp `AiGateway`; Azure AI Speech qua `SpeechProvider`; Handlebars cho template |
| Auth | Lõi auth tự triển khai trong `iam` (ADR-0020/0022): email/mật khẩu Argon2id, Google/Apple/Facebook qua `jose` + JWKS, OTP email/SMS/Zalo; JWT access 15 phút + refresh xoay vòng, thu hồi tức thời theo phiên; cookie httpOnly cho web, bearer cho mobile |
| Kiểm thử | Vitest, Testcontainers (Postgres/Redis), Playwright, Schemathesis/openapi-diff, Promptfoo |
| Hạ tầng | Docker, Terraform (`infra/terraform`), GitHub Actions |

## 4. Bố cục repo

```
apps/web  apps/api  apps/cms  apps/mobile(GĐ4)
packages/schemas  packages/api-client  packages/ui  packages/i18n  packages/scoring  packages/fsrs  packages/config
db/drizzle/schema  db/drizzle/migrations  db/seed
infra/terraform  infra/docker  .github/workflows
docs/spec  docs/adr  docs/runbooks  docs/prompts
```

Module NestJS (`apps/api/src/modules/`): `iam`, `catalog`, `test-engine`, `learning`, `grading`, `speech`, `ai-gateway`, `billing`, `growth`, `analytics`, `b2b`, `admin`. Dùng chung: `apps/api/src/shared/{db,queue,storage,events,auth,i18n,telemetry}`.

## 5. Quy tắc kiến trúc (bắt buộc)

1. **Ranh giới module**: chỉ import `index.ts` công khai của module khác; không truy vấn bảng của module khác (ngoại lệ `analytics` đọc replica). ESLint `boundaries` thực thi thứ tự: `shared` → `iam`/`catalog`/`billing`/`ai-gateway`/`speech` → `test-engine`/`grading` → `learning` → `growth`/`b2b`/`analytics`/`admin`.
2. **Mọi lời gọi AI đi qua `AiGateway.runTask()`/`streamTask()`**. Cấm import SDK model trong module nghiệp vụ. Prompt lấy từ registry DB (seed từ `allingo-prompts.yaml`), không hard-code.
3. **Structured output**: đầu ra AI phải validate bằng Zod trước khi lưu; sai → repair 1 lần → fallback model → `ai_tasks.status = failed` và hoàn credit.
4. **Nội dung người học luôn bọc `<user_input>`**, dữ liệu hệ thống bọc `<data>`; không đưa họ tên/email/số điện thoại/user_id vào prompt.
5. **Tác vụ > 2 giây là job BullMQ** (`jobId` = id nghiệp vụ để idempotent); API chỉ trả 202 + trạng thái; realtime qua Socket.IO.
6. **Credit**: trừ trong cùng transaction với kết quả nghiệp vụ, ghi `billing.credit_ledger` (append-only) và cập nhật `credit_balances`; không bao giờ cập nhật số dư trực tiếp.
7. **Entitlement/quota**: kiểm tra ở server cho mọi endpoint tiêu quota/credit, dù client đã ẩn nút; quota ngày đếm trong Redis, chốt DB hằng đêm.
8. **Exam Mode**: khi người dùng có `attempts.status = in_progress` với `mode = exam`, endpoint giải thích/gia sư trả 403; đề/đáp án không vào `<data>` của tutor.
9. **Nội dung có phiên bản**: mọi câu trả lời trỏ `question_version_id`; chấm lại/xem lại theo phiên bản đã làm.
10. **Đa tenant B2B**: bảng có `org_id` bật RLS; mỗi request `SET LOCAL app.user_id/app.org_id/app.role` trong transaction; vai trò DB của API không có `BYPASSRLS`.
11. **i18n**: không chuỗi cứng trong UI (next-intl); dữ liệu đa ngôn ngữ dạng JSONB `{vi,en,ja,ko,th}`; fallback `en` rồi `vi`.
12. **Outbox**: sự kiện miền ghi `ops.outbox` trong cùng transaction; relay riêng đẩy sang Meilisearch/thông báo/analytics.

## 6. Quy ước mã

- Tên: DB `snake_case`; TypeScript `camelCase`; tệp `kebab-case`; module NestJS `<name>.module.ts`; DTO suy ra từ Zod (`z.infer`).
- API: đường dẫn kebab-case số nhiều; tài nguyên cá nhân dưới `/me`; lỗi envelope `{ error: { code, message, details, trace_id } }`; phân trang cursor `{ data, next_cursor }`; `Idempotency-Key` cho `POST /orders|/submissions|/attempts`.
- Sự kiện `aggregate.past_tense` (`submission.graded`); job `aggregate.action` (`grade.speaking`); flag `ff.<module>.<feature>`.
- Commit theo Conventional Commits; nhánh `feat/<module>-<slug>`; PR ≤ 400 dòng khi có thể; mỗi PR có test.
- Bình luận mã và tài liệu kỹ thuật bằng tiếng Việt khi giải thích nghiệp vụ, tiếng Anh cho API/identifier. Thông điệp cho người dùng cuối qua i18n, không viết thẳng trong code.
- Không `any` không giải thích; không `// eslint-disable` không lý do; không `console.log` trong `apps/api` (dùng pino).

## 7. Lệnh thường dùng

```bash
pnpm i                      # cài đặt
pnpm dev                    # web :3000, api :4000, cms :3001, worker (turbo)
pnpm docker:up              # postgres(pgvector) redis meilisearch minio mailpit
pnpm db:migrate             # drizzle-kit migrate
pnpm db:seed --set core     # programs, sections, question_types, roles, plans, quotas, prompts, model_routes
pnpm db:seed --set demo     # dữ liệu mẫu (không chạy trên prod)
pnpm db:diff                # so Drizzle schema với docs/spec/allingo-schema.sql
pnpm api:openapi            # xuất OpenAPI từ NestJS → apps/api/openapi.generated.yaml
pnpm api:diff               # so với docs/spec/allingo-openapi.yaml
pnpm client:gen             # openapi-typescript → packages/api-client
pnpm lint && pnpm typecheck && pnpm test
pnpm test:e2e               # Playwright
pnpm eval:build && pnpm eval:run   # Promptfoo (cần API key, bỏ qua trong CI nếu thiếu)
```

## 8. Kiểm thử & Definition of Done

Một task chỉ xong khi: (1) `pnpm lint typecheck test` xanh; (2) có unit test cho logic domain mới và integration test (Testcontainers) cho repository/transaction mới; (3) endpoint mới có trong OpenAPI và `pnpm api:diff` xanh; (4) bảng/cột mới có migration và `pnpm db:diff` xanh; (5) không secret, không PII trong log; (6) README/ADR cập nhật nếu đổi kiến trúc; (7) commit message mô tả đúng thay đổi.

## 9. Bảo mật & dữ liệu

- Không commit secret; dùng `.env.example` + biến môi trường; `gitleaks` chạy trong CI.
- Ghi âm/bài viết là dữ liệu cá nhân: chỉ lưu S3 bucket riêng, URL ký 10 phút, vòng đời 90/365 ngày; xoá theo `iam.deletion_requests` trong 72 giờ.
- Log pino không chứa nội dung bài làm, email, số điện thoại; `user_id` băm trong trace Langfuse.
- Mật khẩu Argon2id; OTP 6 số hiệu lực 5 phút, 5 lần sai khoá 30 phút.

## 10. Cách làm việc với tôi

- Bắt đầu mỗi nhiệm vụ lớn bằng **plan mode**: đọc tệp liên quan, liệt kê giả định, chia việc thành task list rồi mới sửa mã.
- Khi thiếu thông tin: nêu giả định hợp lý, ghi vào `docs/ASSUMPTIONS.md`, tiếp tục; chỉ hỏi khi quyết định không thể đảo ngược (xoá dữ liệu, đổi hợp đồng API đã phát hành, chi phí dịch vụ ngoài).
- Không viết lại toàn bộ tệp khi chỉ cần sửa một phần; không đổi thư viện đã chọn mà không có ADR.
- Kết thúc mỗi phiên bằng `docs/HANDOFF.md`: việc đã làm, cách chạy, việc còn lại, rủi ro.
- Không tạo nội dung đề thi sao chép từ ETS/Cambridge/JLPT/HSK thật; nội dung mẫu phải tự viết và gắn `source = 'human'` hoặc `'ai'`.
