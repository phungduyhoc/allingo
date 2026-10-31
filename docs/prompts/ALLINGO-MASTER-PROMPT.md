# Allingo — Master prompt cho Claude Code: khởi tạo monorepo (Sprint 0)

> **Cách dùng.** Tạo thư mục trống `allingo/`, chép `CLAUDE.md` vào gốc, chép 4 tệp đặc tả vào `docs/spec/` (`allingo-schema.sql`, `allingo-openapi.yaml`, `allingo-prompts.yaml`, `allingo-promptfoo.yaml`) và bản xuất Markdown của PRD/Thiết kế kỹ thuật (`prd.md`, `technical-design.md`). Mở Claude Code tại thư mục đó, bật plan mode, dán toàn bộ nội dung từ dòng "=== BẮT ĐẦU PROMPT ===" trở xuống. Sau Sprint 0, dùng tiếp `ALLINGO-SPRINT-PROMPTS.md`.
>
> Yêu cầu máy: Node LTS, pnpm 10, Docker Desktop (≥ 8 GB RAM cho Postgres + Redis + Meilisearch + MinIO), Git. Không cần API key AI cho Sprint 0 (dùng mock provider); có key thì đặt vào `.env.local` để chạy thử `explain_mcq` thật.

=== BẮT ĐẦU PROMPT ===

## 1. Vai trò của bạn

Bạn là Tech Lead kiêm kỹ sư chính của Allingo, chịu trách nhiệm khởi tạo monorepo sản xuất (production-grade) theo đúng Thiết kế kỹ thuật v1.0. Bạn làm việc độc lập, có kỷ luật kỹ thuật cao, ưu tiên kiến trúc rõ ràng, kiểm thử tự động và tài liệu hoá. Bạn không tối ưu hoá sớm, không thêm thư viện ngoài danh sách đã chốt nếu không có lý do ghi thành ADR, và không bịa dữ liệu nghiệp vụ.

## 2. Bối cảnh sản phẩm

Allingo ("Ngoại ngữ cho tất cả") là startup độc lập xây nền tảng luyện thi AI cho TOEIC, IELTS, JLPT, HSK — thị trường Việt Nam, web-first (Next.js + PWA), app mobile ở giai đoạn sau. Giá trị cốt lõi: làm đề đúng định dạng thi, AI giải thích song ngữ từng câu, AI chấm Writing/Speaking theo rubric giám khảo, shadowing & chấm phát âm, từ vựng FSRS, lộ trình thích ứng đến ngày thi; kiếm tiền bằng gói Pro theo chương trình bán trên web qua VNPay/MoMo/ZaloPay với hệ credit AI. Kiến trúc: modular monolith NestJS (Fastify) + worker BullMQ, PostgreSQL một cụm 6 schema, Redis, S3-compatible, Meilisearch, AI Gateway đa model, Payload CMS; tất cả TypeScript trong một monorepo Turborepo.

## 3. Tài liệu đầu vào — ĐỌC TRƯỚC KHI VIẾT MÃ

Đọc đầy đủ, theo thứ tự, và tóm tắt lại cho tôi 10 dòng những gì bạn hiểu trước khi lập kế hoạch:

1. `CLAUDE.md` — quy tắc thường trực (kiến trúc, quy ước, DoD, bảo mật). Tuân thủ tuyệt đối.
2. `docs/spec/allingo-schema.sql` — DDL PostgreSQL tham chiếu (6 schema, 97 bảng, enum, index, partition theo tháng, RLS, view, seed tối thiểu). Đây là nguồn sự thật của mô hình dữ liệu.
3. `docs/spec/allingo-openapi.yaml` — hợp đồng REST API v1 (99 đường dẫn, 111 operation, 63 schema, quy ước lỗi/phân trang/idempotency/SSE/WebSocket).
4. `docs/spec/allingo-prompts.yaml` — 14 prompt version (system, user template Handlebars, JSON Schema đầu ra, model policy, ngưỡng eval) và `scoring_rules`.
5. `docs/spec/allingo-promptfoo.yaml` — cấu hình eval.
6. `docs/spec/technical-design.md` — kiến trúc, ADR-01…18, cấu trúc monorepo, luồng xử lý, AI Gateway, bảo mật, hạ tầng, kế hoạch kỹ thuật theo giai đoạn (mục 12 là thứ tự sprint).
7. `docs/spec/prd.md` — yêu cầu chức năng (FR-Mx-nn) khi cần hiểu nghiệp vụ.

Nếu một tệp thiếu, dừng lại và báo tên tệp; không tự suy đoán nội dung của nó.

## 4. Mục tiêu Sprint 0 — "repo chạy end-to-end một vòng học"

Kết thúc Sprint 0, một lập trình viên mới clone repo, chạy `pnpm i && pnpm docker:up && pnpm db:migrate && pnpm db:seed --set core,demo && pnpm dev` và trong trình duyệt có thể: tạo tài khoản khách → mở một đề TOEIC mini (Part 5, 10 câu) → làm bài trong Exam Mode (lưu nháp) → nộp → xem kết quả & xem lại từng câu → bấm "Giải thích" và nhận giải thích AI (mock provider nếu không có API key) → đăng ký tài khoản email và thấy tiến độ được ghép. Đồng thời CI xanh với lint, typecheck, unit, integration, `db:diff`, `api:diff`.

### 4.1 Deliverables bắt buộc

**A. Monorepo & công cụ**
- Turborepo + pnpm workspaces; `apps/web`, `apps/api` (entry `main.ts` và `worker.ts`), `apps/cms`; `packages/schemas`, `packages/api-client`, `packages/ui`, `packages/i18n`, `packages/scoring`, `packages/fsrs`, `packages/config` (eslint/tsconfig/tailwind/prettier dùng chung).
- `infra/docker/compose.dev.yml`: PostgreSQL 16+ (image có `pgvector`), Redis/Valkey, Meilisearch, MinIO (+ bucket init), Mailpit. Script `pnpm docker:up|down|reset`.
- `.github/workflows/ci.yml`: install (cache pnpm) → lint → typecheck → unit test → build → integration test với service containers Postgres/Redis → `db:diff` → `api:diff` → gitleaks → Trivy fs. `preview.yml` để trống có TODO (triển khai ở Sprint 11).
- `docs/VERSIONS.md` ghi phiên bản chính xác mọi framework đã cài; `docs/adr/0001-…` đến `0018-…` chuyển từ bảng ADR trong thiết kế (mỗi ADR một tệp, mẫu Context–Decision–Consequences); `docs/ASSUMPTIONS.md`; `docs/HANDOFF.md`; `README.md` hướng dẫn chạy ≤ 1 trang.

**B. Cơ sở dữ liệu**
- `db/drizzle/schema/<schema>/*.ts` cho **toàn bộ** 6 schema theo DDL (enum, bảng, index, FK, composite PK, `UNIQUE NULLS NOT DISTINCT`, cột JSONB có kiểu TypeScript qua `$type<>()`), tách theo module. Partition và RLS không mô tả được bằng Drizzle thì viết SQL tay trong migration (`db/drizzle/migrations/0001_init.sql` chứa `CREATE TABLE … PARTITION BY`, `ops.ensure_month_partition()`, policy RLS) — mục tiêu `pnpm db:diff` (dùng `migra` hoặc `pg-schema-diff` trong container) báo không lệch so với `docs/spec/allingo-schema.sql`.
- `db/seed/core.ts`: programs, skills, sections (TOEIC Part 1–7 đủ metadata; IELTS Listening/Reading/Writing/Speaking; JLPT và HSK khung section theo cấp), question_types (12 dạng, `content_schema` trỏ `packages/schemas`), roles, plans/prices/quotas theo PRD mục 4 (Free/Pro tháng/năm/trọn đời/combo, bảng credit), badges, prompt_templates/prompt_versions/model_routes nạp từ `docs/spec/allingo-prompts.yaml`, feature_flags mặc định. Idempotent (upsert theo khoá tự nhiên).
- `db/seed/demo.ts`: 1 đề TOEIC mini Part 5 (10 câu) + 1 đề TOEIC Listening Part 2 mini (6 câu, audio placeholder .mp3 ngắn sinh bằng TTS mock hoặc tệp tĩnh), 20 từ vựng, 1 bài học, 5 người dùng mẫu (`learner_free`, `learner_pro`, `teacher`, `admin`, `org_admin`), 1 tổ chức + 1 lớp. Nội dung câu hỏi **tự viết**, `source = 'human'`; có guard không chạy trên `APP_ENV=production`.

**C. `packages/schemas`**
- Zod cho 12 `question_type` (discriminated union theo `type`), kiểu `QuestionContent`, `AnswerInput`, hàm `grade(content, answer)` cho dạng chấm tự động; Zod cho DTO API chính (Auth, Me, Enrollment, Attempt, AttemptAnswerInput, AttemptResult, Review, Explanation, Submission, GradingResult, Plan, Order…) khớp `allingo-openapi.yaml`; Zod cho 14 đầu ra AI sinh từ JSON Schema trong `allingo-prompts.yaml` (script `pnpm schemas:gen-ai` dùng `json-schema-to-zod` rồi sửa tay nếu cần, có test đảm bảo tương đương).

**D. `apps/api` (NestJS + Fastify)**
- Khung dự án: config typed (Zod cho env), pino + OpenTelemetry (exporter OTLP, tắt được), health (`/health/live`, `/health/ready`), global exception filter theo envelope lỗi, interceptor `trace_id`, Zod validation pipe, Swagger/OpenAPI generation (`pnpm api:openapi`), CORS, Helmet, rate limit cơ bản (Fastify), Socket.IO gateway `/ws` với auth.
- `shared/db`: Drizzle client, transaction helper, `withRls({ userId, orgId, role })` đặt `SET LOCAL`, read-replica switch.
- `shared/queue`: BullMQ queues `grading`, `content`, `media`, `notify`, `analytics`; helper `enqueue(jobName, id, payload)` với `jobId` idempotent; `worker.ts` đăng ký processors; dead-letter → `ops.jobs_deadletter`.
- `shared/storage`: S3 client (MinIO dev), presigned PUT/GET, bucket `media`, `recordings`.
- `shared/events`: outbox writer + relay job (poll `ops.outbox` → publish nội bộ; stub Meilisearch index).
- Module `iam`: Better Auth cấu hình (email/password, Google/Apple/Facebook để stub nếu thiếu client id; OTP plugin stub trả mã cố định ở dev); guest session (`POST /auth/guest`), ghép khách khi đăng ký; `/me`, `/me/enrollments` (GET/POST/PATCH), `/me/sessions`, `/me/consents`; RBAC guard `@Roles()`; refresh xoay vòng và thu hồi.
- Module `catalog`: đọc programs/sections/test-sets/lessons/videos/vocab (các GET trong OpenAPI); lọc đáp án khỏi nội dung trả client (`QuestionPublic`); CMS writes qua Payload (xem F).
- Module `test-engine`: `POST /attempts`, `GET /attempts/{id}`, `PUT /attempts/{id}/answers` (bulk upsert nháp vào `attempts.draft_state` và `attempt_answers`), `POST /attempts/{id}/events`, `POST /attempts/{id}/submit` (chấm tự động bằng `packages/schemas.grade`, quy đổi điểm bằng `packages/scoring`, `score_breakdown`, outbox `attempt.graded`), `GET /attempts/{id}/review`, `GET /me/attempts`, `GET /practice/questions`; quota Free kiểm tra qua `billing`.
- Module `billing` (tối thiểu Sprint 0): `plans`, `prices`, `quotas` đọc từ seed; `EntitlementService.check(userId, feature)`; `QuotaService` đếm Redis theo ngày/tháng + chốt DB bằng job đêm; `CreditService.charge()/grant()` với ledger append-only trong transaction; `GET /me/entitlements`, `GET /me/credits`. Cổng thanh toán để interface `PaymentProvider` + adapter `MockPaymentProvider` (Sprint 6 làm thật).
- Module `ai-gateway`: `AiGateway.runTask()/streamTask()/estimateCredits()`; `TaskRegistry` đọc `ai.prompt_templates/prompt_versions/model_routes` (cache 60 s); `PromptRenderer` Handlebars có partial `common_system` và helper `json`; `ModelRouter` với adapter `google|anthropic|openai` qua Vercel AI SDK và `MockProvider` (đọc fixture JSON theo task_code) dùng khi không có key hoặc `AI_PROVIDER=mock`; `StructuredOutput` validate Zod, repair 1 lần, fallback; `ExplanationCache` (`ai.explanation_cache` + Redis); `Metering` ghi `ai.ai_tasks` và trừ credit cùng transaction; `Guardrails` gọi `guard_classify` (mock ở dev) và khoá Exam Mode; `POST /ai/explain` (JSON khi cache hit, SSE khi sinh mới); `POST /ai/threads`, `POST /ai/threads/{id}/messages` (SSE) với ngữ cảnh tối thiểu (attempt summary) — đủ để demo, phần proactive/voice để Sprint 5.
- Module `learning` (khung): `enrollments` dùng chung với `iam`; `streaks`/`xp_events` cập nhật khi nộp bài; `GET /me/stats` tối thiểu (điểm gần nhất, streak, XP). Lộ trình/FSRS để Sprint 9.
- Các module còn lại (`grading`, `speech`, `growth`, `analytics`, `b2b`, `admin`): tạo khung module + README nêu phạm vi, chưa có endpoint (trừ `admin` có `GET /admin/reports/ai-costs` đọc `ai.ai_tasks` để kiểm tra metering).

**E. `apps/web` (Next.js)**
- App Router với `[locale]` (vi mặc định, en), next-intl, Tailwind + shadcn/ui, theme token cơ bản (navy/gold cho thương hiệu Allingo, dark mode), PWA manifest + service worker shell (Serwist), layout `(marketing)` và `(app)`.
- Trang: landing `/` (hero, 4 chương trình, CTA), `/login`, `/signup` (Better Auth client), `/toeic/dashboard` (streak, XP, điểm gần nhất, nút "Làm đề mini"), `/toeic/test-sets`, `/attempts/[id]` (Exam Mode: đồng hồ, lưu nháp mỗi 10 s, nộp), `/attempts/[id]/result`, `/attempts/[id]/review` (tra đáp án, nút Giải thích gọi SSE), `/settings` (ngôn ngữ, mục tiêu). Trạng thái chế độ khách hiển thị rõ và nút "Đăng ký để lưu tiến độ".
- `packages/api-client`: sinh bằng `openapi-typescript` từ `docs/spec/allingo-openapi.yaml` + fetch wrapper (cookie/bearer, refresh tự động, envelope lỗi) + hooks TanStack Query cho các endpoint đã dùng.
- Accessibility: điều khiển bàn phím cho Exam Mode, aria cho đồng hồ; Lighthouse local ≥ 85 Performance/≥ 95 Accessibility trên trang landing (ghi kết quả vào HANDOFF).

**F. `apps/cms` (Payload CMS)**
- Payload trên Next.js, PostgreSQL adapter dùng schema `cms` cho bảng nội bộ của Payload; collections `questions`, `question_versions`, `passages`, `test_sets`, `media_assets`, `lessons`, `videos`, `vocab_items`, `prompt_templates`, `prompt_versions` **ánh xạ tới bảng trong schema `catalog`/`ai`** (dùng Payload hooks ghi qua `apps/api` service hoặc truy vấn Drizzle trực tiếp — chọn một, ghi ADR). Nếu ánh xạ bảng ngoài quá phức tạp trong Sprint 0, chấp nhận Payload giữ bản sao và job đồng bộ sang `catalog` — ghi rõ ADR và TODO.
- Workflow trạng thái `draft → ai_checked → review1 → review2 → published` với vai trò `editor/teacher/admin`; nút "Gửi AI kiểm tra" gọi `check_question` qua gateway (mock ở dev).
- Form nhập câu hỏi theo `question_type` với validate Zod từ `packages/schemas`; nhập hàng loạt CSV/JSON.

**G. Kiểm thử**
- Unit (Vitest): `packages/scoring` (quy đổi TOEIC L&R, làm tròn IELTS), `packages/fsrs` (lịch ôn), `packages/schemas` (grade từng dạng câu, Zod AI output), `ai-gateway` (router/fallback/repair với mock), `billing` (ledger không âm, quota reset).
- Integration (Testcontainers Postgres + Redis): tạo attempt → lưu nháp → nộp → review; credit charge trong transaction (rollback khi lỗi); RLS (user org A không đọc lớp org B); outbox ghi cùng transaction.
- Contract: `pnpm api:diff` so OpenAPI sinh từ NestJS với spec (cho phép thiếu endpoint chưa làm, cấm lệch endpoint đã làm) — viết script so sánh theo danh sách đường dẫn đã triển khai.
- E2E (Playwright, chạy local, CI để `continue-on-error` Sprint 0): luồng khách → làm đề mini → nộp → giải thích (mock).

### 4.2 Ngoài phạm vi Sprint 0 (không làm, chỉ để khung)
Chấm Writing/Speaking, Speech Service, voice realtime, lộ trình thích ứng, FSRS UI, cổng thanh toán thật, hoá đơn điện tử, Google Calendar, mobile, i18n ja/ko/th, Terraform cloud (chỉ để thư mục + README), Meilisearch index thật (stub).

## 5. Ràng buộc kỹ thuật

1. TypeScript `strict: true`, `noUncheckedIndexedAccess: true`; ESM; path alias `@allingo/*`.
2. Phiên bản: dùng bản ổn định mới nhất tại thời điểm khởi tạo cho Next.js, NestJS, Drizzle, Payload, Vercel AI SDK, Zod, Vitest, Playwright; ghi vào `docs/VERSIONS.md`; không dùng bản canary/beta trừ khi bắt buộc và có ADR.
3. Không thêm thư viện ngoài danh sách trong `CLAUDE.md` mục 3 nếu không có ADR; không dùng Prisma, TypeORM, Express, Redux, Moment.
4. Cấu hình qua biến môi trường validate bằng Zod lúc khởi động (`apps/api/src/config/env.ts`); `.env.example` đầy đủ, không giá trị thật.
5. Mọi truy cập DB qua Drizzle; SQL thô chỉ trong migration hoặc truy vấn phức tạp có chú thích; không chuỗi nối SQL từ input.
6. Không gọi SDK AI ngoài `ai-gateway`; không hard-code prompt; mock provider phải sinh đầu ra hợp lệ theo Zod cho mọi task_code (fixture trong `apps/api/test/fixtures/ai/`).
7. Lưu nháp bài làm: upsert theo lô, idempotent theo `(attempt_id, question_id)`; nộp bài idempotent (nộp lần 2 trả kết quả cũ).
8. Hiệu năng cục bộ: `POST /attempts` cho đề 200 câu trả ≤ 300 ms với DB local; `PUT /answers` lô 50 câu ≤ 100 ms (ghi vào HANDOFF cách đo).
9. Không PII trong log; `user_id` chỉ ở mức debug; trace_id mọi response.
10. Giấy phép: chỉ thư viện MIT/Apache/BSD/ISC; ghi `pnpm licenses list` vào `docs/LICENSES.md`.

## 6. Quy trình làm việc bắt buộc

1. **Plan mode trước**: đọc tài liệu mục 3; trả lời tôi bằng (a) tóm tắt 10 dòng, (b) danh sách giả định, (c) task list 20–35 việc theo thứ tự phụ thuộc với ước lượng, (d) 3–5 rủi ro kỹ thuật. Chờ tôi xác nhận rồi mới sửa mã. Nếu tôi không trả lời trong phiên, tiếp tục với giả định đã nêu và ghi vào `docs/ASSUMPTIONS.md`.
2. Làm theo task list, đánh dấu từng việc; sau mỗi nhóm việc hoàn chỉnh (tooling → db → api iam → test-engine → ai-gateway → web → cms → tests → CI) chạy `pnpm lint typecheck test` và commit với Conventional Commits (`feat(db): drizzle schema for iam & catalog`).
3. Khi một tệp đặc tả mâu thuẫn với tệp khác (ví dụ OpenAPI có trường mà DDL không có), chọn theo thứ tự ưu tiên DDL > OpenAPI > PRD cho dữ liệu, OpenAPI > PRD cho API; ghi vào `docs/SPEC-ISSUES.md` với đề xuất sửa; không tự sửa tệp trong `docs/spec/`.
4. Không hỏi tôi những câu có thể tự quyết hợp lý (tên biến, bố cục thư mục con, thư viện trong danh sách). Hỏi khi: xoá/ghi đè dữ liệu, cần API key/dịch vụ trả phí, quyết định đổi kiến trúc so với ADR.
5. Mỗi 60–90 phút làm việc hoặc trước khi dừng: cập nhật `docs/HANDOFF.md` (đã làm, cách chạy, đang dở, việc kế tiếp, rủi ro), đảm bảo repo ở trạng thái build được.
6. Viết test cùng lúc với mã, không để cuối; tối thiểu theo mục 4.1 G.
7. Không "giả lập thành công": nếu một lệnh thất bại, sửa nguyên nhân hoặc ghi lỗi rõ ràng vào HANDOFF; không comment-out test để CI xanh.

## 7. Tiêu chí nghiệm thu Sprint 0 (tôi sẽ chạy đúng các lệnh này)

```bash
git clone … && cd allingo && pnpm i
pnpm docker:up && pnpm db:migrate && pnpm db:seed --set core,demo
pnpm db:diff          # kỳ vọng: no differences (hoặc chỉ khác biệt đã ghi trong docs/SPEC-ISSUES.md)
pnpm lint && pnpm typecheck && pnpm test      # tất cả xanh
pnpm api:openapi && pnpm api:diff             # endpoint đã triển khai khớp spec
pnpm dev
```
Sau đó trên trình duyệt: (1) vào `/vi`, landing hiển thị 4 chương trình; (2) bấm "Luyện thử" → tài khoản khách được tạo → `/vi/toeic/dashboard`; (3) mở đề TOEIC Part 5 mini, làm 10 câu, tải lại trang giữa chừng thì nháp vẫn còn, nộp → kết quả có điểm thô và ước tính, breakdown theo Part; (4) `/review` hiển thị đáp án, bấm "Giải thích" → SSE hiển thị giải thích (mock) đúng schema, lần bấm thứ hai trả từ cache (`cached: true`); (5) đăng ký email → lịch sử bài làm của khách xuất hiện trong tài khoản mới; (6) đăng nhập `teacher` vào CMS `:3001/admin`, thấy câu hỏi demo, tạo một câu hỏi mới Part 5 hợp lệ, gửi "AI kiểm tra" (mock) → trạng thái `ai_checked`; (7) `GET /admin/reports/ai-costs` (bằng tài khoản admin) liệt kê `ai_tasks` vừa tạo với credit đã trừ = 1 và cache hit không trừ; (8) tắt Redis → `PUT /answers` vẫn lưu được vào DB (degrade có chủ đích) và log cảnh báo; bật lại → bình thường; (9) CI trên GitHub xanh ở commit cuối.

## 8. Đầu ra cuối cùng của Sprint 0

- Repo với lịch sử commit sạch theo Conventional Commits.
- `README.md` (chạy trong 5 phút), `docs/VERSIONS.md`, `docs/LICENSES.md`, `docs/adr/0001–0018`, `docs/ASSUMPTIONS.md`, `docs/SPEC-ISSUES.md`, `docs/HANDOFF.md` có mục "Việc đề xuất cho Sprint 1" khớp `ALLINGO-SPRINT-PROMPTS.md`.
- Bản báo cáo ngắn trong chat: những gì đã chạy được theo mục 7, những gì chưa, số test, thời gian `pnpm i`/`pnpm build`, kích thước bundle web.

## 9. Những điều KHÔNG làm

- Không sao chép đề thi, audio hay giáo trình của ETS/Cambridge/JLPT/HSK hoặc nội dung từ bất kỳ sản phẩm nào khác; mọi câu hỏi mẫu tự viết.
- Không đưa API key, mật khẩu, token vào mã hoặc commit; không log PII.
- Không tạo microservice, message broker, hay GraphQL; không đổi sang ORM khác.
- Không viết mã "để sau sẽ sửa" mà không có TODO kèm issue trong HANDOFF.
- Không vượt phạm vi Sprint 0 (mục 4.2) dù thấy dễ; ghi vào đề xuất Sprint 1.

=== KẾT THÚC PROMPT ===
