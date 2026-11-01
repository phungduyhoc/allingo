# HANDOFF — Sprint 0 (01/11/2026)

Bàn giao sau phiên Claude Code dựng walking skeleton Allingo. Đọc cùng `README.md`, `CLAUDE.md`, `docs/ASSUMPTIONS.md`, `docs/SPEC-ISSUES.md`.

## 1. Kết quả theo tiêu chí nghiệm thu (master prompt §7)

| # | Tiêu chí | Kết quả | Ghi chú |
| --- | --- | --- | --- |
| 1 | `pnpm i` · `docker:up` · `db:migrate` · `db:seed --set core,demo` | ĐẠT | Trong phiên không có Docker daemon → Postgres 16 + pgvector 0.6, Valkey chạy cục bộ (A1); `compose.dev.yml` đầy đủ cho máy dev |
| 2 | `pnpm db:diff` | ĐẠT | 97 bảng, 188 index, 4 policy RLS khớp spec; Drizzle schema khớp 97 bảng |
| 3 | `pnpm lint && typecheck && test` | ĐẠT | turbo 35/35 task; test: api 36 (21 unit + 15 integration), db 8 (integration Postgres), api-client 8, web 12, cms 24, schemas/scoring/fsrs unit |
| 4 | `pnpm api:openapi && api:diff` | ĐẠT | 45/112 operation triển khai, 0 lệch; 67 operation còn lại thuộc Sprint 1–10 |
| 5 | Trình duyệt (1)–(5): landing 4 chương trình → khách → dashboard → đề Part 5 mini (nháp giữ khi tải lại) → nộp (điểm thô + ước tính + breakdown) → review → Giải thích SSE rồi `cached: true` → đăng ký ghép tiến độ | ĐẠT | Playwright `e2e/guest-flow.spec.ts` 3/3 với API thật và 6/6 với mock (desktop + mobile); ảnh màn hình đính kèm báo cáo |
| 6 | CMS: teacher đăng nhập, thấy câu demo, tạo câu Part 5 mới, "AI kiểm tra" → `ai_checked` | ĐẠT | Qua UI và REST (`POST /api/questions/{id}/ai-check`); mock `check_question` trả `verdict: pass` |
| 7 | `GET /admin/reports/ai-costs` liệt kê `ai_tasks`, credit explain = 1, cache hit không trừ | ĐẠT | Thêm `explanation_cache_hits` (đếm từ `ai.explanation_cache.hit_count`, tăng cả khi trúng Redis) |
| 8 | Tắt Redis → `PUT /answers` vẫn lưu DB, log cảnh báo; bật lại → bình thường | ĐẠT | Log `redis connection lost (degraded mode…)`; `/v1/health/ready` báo `redis: false` rồi `true` |
| 9 | CI GitHub xanh | CHƯA | Repo chưa push (GitHub chưa liên kết trong phiên). Workflow `ci.yml` đã rà lại để khớp lệnh; cần push và xem lần chạy đầu |

Số liệu: `pnpm i` ~2 phút (cold, 1.070 gói); `pnpm build` toàn repo ~2 phút (web 16 s với Turbopack cache); JS client web 433 KB gzip tổng, chunk lớn nhất 102 KB gz (recharts, tải động ở trang kết quả); Lighthouse chưa đo (không có Chromium headless trong phiên — dùng Chrome hệ thống cho Playwright).

## 2. Đã làm (theo nhóm việc Sprint 0)

1. **Nền tảng**: Turborepo + pnpm 10, TS 5.9 strict, ESLint 9 flat + `eslint-plugin-boundaries` (ranh giới module §5.1 — đã kiểm chứng bắt vi phạm sau khi thêm resolver TypeScript), Prettier, Vitest 4, compose dev, CI 4 job, 21 ADR.
2. **Lớp dữ liệu** (`db/`): migration 0001 = DDL nguyên văn; Drizzle schema sinh bằng `drizzle-kit pull` + `organize-schema.ts` (4 bảng partition viết tay); `db:diff` 2 lớp; `withRls`; partition tháng; seed core (programs/sections/question_types/roles/plans/quotas/prompts/model_routes/badges/flags) + demo (16 câu TOEIC P5/P2 tự biên soạn, 2 bộ đề mini, 1 bài học, từ vựng, 2 người học, 1 tổ chức).
3. **Packages**: `schemas` (Zod cho content 4 dạng câu, answer, AI output 14 task sinh từ JSON Schema, product constants), `scoring` (TOEIC ước tính), `fsrs` (ts-fsrs 6), `api-client` (openapi-fetch cookie/bearer, refresh 1 lần, SSE reader, hooks), `i18n` (vi/en 352 khoá), `ui` (Button/Card/Dialog/Tabs… trên `<dialog>` + roving tabindex), `config`.
4. **API** (`apps/api`, NestJS 12/Fastify 5, ESM): shared (env Zod, pino redaction, OTel, Drizzle/RLS, Redis degrade, BullMQ, S3 presign, outbox + EventEmitter, JWT + refresh xoay vòng, AuthGuard cookie/bearer, Socket.IO, envelope lỗi + trace_id, Zod pipe + OpenAPI metadata); modules `iam` (register/login/guest/refresh/logout, ghép khách, /me, sessions, consents, enrollments, credit chào mừng), `catalog` (programs/test-sets/lessons/vocab, QuestionPublic lọc answer_key, API nội bộ CMS publish/check/reference), `billing` (entitlement cache, quota Redis + DB fallback + flush đêm, credit ledger append-only), `ai-gateway` (registry DB + canary, Handlebars, ModelRouter + circuit breaker, adapter Vercel AI SDK google/anthropic/openai + MockProvider 14 task, structured output validate→repair→fallback→failed, metering + credit cùng transaction, ExplanationCache, Guardrails, SSE), `test-engine` (attempt snapshot, nháp idempotent, grace 30 s, submit idempotent, grade, review, drills), `learning` (XP/streak), `admin` (ai-costs), worker (outbox relay, quota flush, partition ensure).
5. **CMS** (`apps/cms`, Payload 3.92 trên Next 16, schema `cms`): collections questions/passages/test-sets/lessons/vocab/media/prompts/users, workflow draft→ai_checked→review1→review2→published, nút AI kiểm tra, import JSON/CSV, phát hành sang catalog qua `/v1/internal/content/*` (`X-Internal-Token`), seed CMS, 24 test.
6. **Web** (`apps/web`, Next 16 App Router, next-intl, Tailwind 4, TanStack Query, PWA SW đóng gói bằng esbuild): landing, login/signup, dashboard, test-sets, Exam/Practice Mode (đồng hồ theo `expires_at` + `server_time`, nháp gộp lô 10 s + offline queue, phím tắt, audio `once`, hết giờ tự nộp), result (recharts), review (SSE explain + cache + quota CTA), settings; mock API bám OpenAPI (`dev:mock`).
7. **Tài liệu**: README, VERSIONS, LICENSES, ASSUMPTIONS A1–A15, SPEC-ISSUES S1–S10, ADR 0001–0021, prompts master/sprint, runbook thư mục (trống, Sprint 1 bổ sung secrets.md).

## 3. Cách chạy & kiểm tra

Xem `README.md` (5 phút). Kiểm tra nhanh toàn bộ: `pnpm lint && pnpm typecheck && pnpm test && pnpm db:diff && pnpm api:openapi && pnpm api:diff`. E2E API thật: chạy `pnpm dev` rồi `E2E_REAL_API=1 E2E_NO_SERVER=1 pnpm --filter @allingo/web test:e2e`. Chụp màn hình rà soát UI: `SHOT_DIR=/tmp/shots E2E_NO_SERVER=1 E2E_REAL_API=1 pnpm --filter @allingo/web exec playwright test e2e/screenshots.spec.ts --project=chromium`.

Lưu ý môi trường phiên: Playwright không tải được Chromium (cdn.playwright.dev chặn) → `E2E_CHROME_CHANNEL=chrome`; trên máy dev/CI dùng `playwright install chromium` bình thường.

## 4. Việc còn lại / TODO có chủ đích

| # | Việc | Nơi | Sprint |
| --- | --- | --- | --- |
| T1 | Push repo lên GitHub `phungduyhoc/allingo`, bật branch protection, xác nhận CI xanh (mục 9) | `.github/workflows/ci.yml` | Ngay |
| T2 | Better Auth thật (Google/Apple/Facebook/OTP) thay lõi auth Sprint 0 (ADR-0020) | `apps/api/src/modules/iam` | S1 |
| T3 | 8 dạng câu còn lại trong `packages/schemas` (matching, drag_drop, map_label, ordering, dictation, essay, speaking, handwriting) + `grade()` | `packages/schemas/src/question` | S1 |
| T4 | Terraform modules + `deploy-staging.yml` + runbook secrets | `infra/terraform`, `.github/workflows` | S1 |
| T5 | CMS: đồng bộ media/lessons/vocab khi phát hành (hiện chỉ questions/passages/test-sets), `payload migrate` cho prod, Playwright cho CMS | `apps/cms` | S2 |
| T6 | Thử AI thật với khoá Gemini: eval Promptfoo `explain_mcq`, `check_question` ≥ ngưỡng trong `allingo-prompts.yaml` (A5) | `pnpm eval:*` | S2 (trước GATE-1) |
| T7 | Practice Mode: endpoint kiểm tra đáp án tức thì (client không nhận `answer_key`) | test-engine + web | S3 |
| T8 | Job `attempt.expire` quét `draft_state->>'expires_at'`; cân nhắc cột `expires_at` (S2) | test-engine worker | S3 |
| T9 | Meilisearch/MinIO/Mailpit: relay outbox → Meilisearch, upload audio thật qua S3 presign | shared/storage, worker | S2 |
| T10 | Thay audio demo WAV tổng hợp bằng TTS Azure (A7) | `apps/web/public/demo-audio` | S2 |
| T11 | Lighthouse mobile ≥ 90 cho landing/dashboard; đo và ghi vào HANDOFF | web | S1 |
| T12 | `pnpm audit` và trivy đang `exit-code 0` trong CI — chuyển sang chặn khi có baseline | ci.yml | S1 |

## 5. Rủi ro & lưu ý vận hành

- **Cache giải thích dùng chung** theo (question_version, chosen_option, locale) giữa mọi người học: đúng spec, tiết kiệm credit, nhưng UX cần nói rõ "giải thích đã có sẵn" (web đã hiển thị nhãn). Test tích hợp tự dọn cache của câu đang test.
- **Exam Mode** chặn giải thích **trước** cache hit (sửa trong phiên này — trước đó cache hit lọt qua khoá). Khoá đặt ở Redis `exam:lock:{userId}`; khi Redis degrade, Guardrails đọc DB (`attempts.status = in_progress AND mode = exam`).
- **CORS**: đã cho phép PUT/PATCH/DELETE + `Idempotency-Key`, `X-Client`, `X-Internal-Token`; `CORS_ORIGINS` phải khớp domain web khi lên staging.
- **Lịch sử git**: commit theo module, chưa push; `apps/web/AGENTS.md` do Next tự sinh đã xoá và tắt `agentRules`.
- **Giá/quota/credit** trong seed là giá trị tạm (A9); Free 300 credit/tháng, khách 30 credit — đổi trong admin trước khi bán.
- **Mock AI** trả kết quả cố định đúng schema; không dùng để đánh giá chất lượng nội dung.

## 6. Đề xuất Sprint 1 (khớp `docs/prompts/ALLINGO-SPRINT-PROMPTS.md` §S1)

1. `iam`: Better Auth Google/Apple/Facebook + OTP email/SMS (`SmsProvider`), guest merge đầy đủ 8 bảng + audit `guest.merged`, RBAC `@Roles()`, `/me/sessions*`, phát hiện tái sử dụng refresh token, `/me/consents`, `DELETE /me` + job `iam.purge` 72 giờ, Turnstile, outbox `user.*` (T2).
2. `packages/schemas`: đủ 12 dạng câu + `grade()` + fixture 3 câu/dạng + JSON Schema xuất `schemas/question/*.json` (T3, S7).
3. `infra`: Terraform modules + envs dev/staging, `deploy-staging.yml`, `preview.yml`, `docs/runbooks/secrets.md` (T4). Chốt phương án hạ tầng bằng ADR trước khi apply.
4. Dọn nợ Sprint 0: T1, T11, T12; cập nhật OpenAPI theo S3/S4 (hoặc giữ mở rộng tương thích và ghi vào YAML).
