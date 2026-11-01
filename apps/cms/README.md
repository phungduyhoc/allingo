# @allingo/cms – Payload CMS 3 (soạn thảo nội dung)

CMS soạn thảo câu hỏi, đoạn văn, bộ đề, bài học, từ vựng cho Allingo. Theo **ADR-0019**: Payload giữ dữ liệu soạn thảo
trong schema PostgreSQL **`cms`** (bảng do Payload quản lý, cùng cụm DB với API); khi **phát hành**, CMS gọi API nội bộ
của `apps/api` (`POST /internal/content/*`) để ghi vào `catalog` – **CMS không ghi trực tiếp `catalog.*`/`ai.*`**.
`catalog` là nguồn sự thật cho người học.

## Chạy

```bash
# Postgres (compose) + apps/api đang chạy ở :4000 (để AI kiểm tra / phát hành; không có vẫn soạn thảo được)
cp apps/cms/.env.example apps/cms/.env.local        # hoặc dùng .env ở gốc repo
cd apps/cms
pnpm exec payload generate:importmap                # sinh src/app/(payload)/admin/importMap.js
pnpm exec payload generate:types                    # sinh src/payload-types.ts
pnpm exec tsx scripts/seed-cms.ts                   # tài khoản demo + 16 câu + 2 bộ đề mini (idempotent)
pnpm dev                                            # http://localhost:3001/admin
```

Biến môi trường: `DATABASE_URL`, `CMS_DATABASE_SCHEMA=cms`, `PAYLOAD_SECRET`, `CMS_PUBLIC_URL`, `INTERNAL_API_URL`
(`http://localhost:4000/v1`), `INTERNAL_API_TOKEN`, tuỳ chọn `CMS_MEDIA_DIR`, `INTERNAL_API_TIMEOUT_MS`.
Dev: `push: true` – Payload tự đồng bộ bảng trong schema `cms` (drizzle push, chỉ lọc schema `cms`). Prod: `push` tắt,
dùng `payload migrate` (thư mục `apps/cms/migrations`).

Kiểm tra: `pnpm typecheck` · `pnpm lint` · `pnpm test` (Vitest, `test/*.test.ts`) · `pnpm build`.

## Tài khoản demo (seed)

| Email | Mật khẩu | Vai trò |
| --- | --- | --- |
| `admin@allingo.dev` | `Allingo@2026` | admin – toàn quyền, quản lý người dùng, xoá |
| `teacher@allingo.dev` | `Allingo@2026` | teacher – duyệt vòng 1/2, phát hành, tạo bộ đề |
| `editor@allingo.dev` | `Allingo@2026` | editor – soạn, gửi AI kiểm tra, gửi duyệt |

16 câu demo được seed ở trạng thái `published` nhưng **`publishedRef` trống** (seed không gọi API). Để đưa vào catalog:
mở từng câu → đổi nội dung nhỏ và lưu (teacher/admin) sẽ gọi `questions/publish` tạo version mới; hoặc dùng
`db/seed demo` của API vốn đã có 16 câu này.

## Collections

| Slug | Nội dung |
| --- | --- |
| `users` | Người dùng CMS (`role`: editor/teacher/admin; `apiUserEmail` → `created_by_email` khi phát hành) |
| `media` | Upload audio/ảnh vào `apps/cms/media/` (`kind`, `durationMs`, `license` own/cc-by/licensed:<ref>, `transcript`) |
| `passages` | Đoạn đọc/script/ảnh đề dùng chung cho nhóm câu |
| `questions` | Câu hỏi: `program`, `sectionCode`, `questionType` (12 dạng), `content` (JSON validate Zod theo dạng), workflow, `aiReport`, `reviews`, `publishedRef`, `externalRef` (= id) |
| `test_sets` | Bộ đề: `code` duy nhất, `kind`, `sections[]`, `items[]`; TOEIC full phải đủ Part 1–7 (6/25/39/30/30/16/54); mọi câu phải `published` |
| `lessons`, `vocab_items` | Bài học, từ vựng (đồng bộ sang catalog ở Sprint 1) |
| `prompt_templates`, `prompt_versions` | **Chỉ nháp** – nguồn sự thật là `ai.*` qua API admin; `status` chỉ đọc |

## Quy trình duyệt câu hỏi (`src/lib/workflow.ts`)

```
draft ──(nút "Gửi AI kiểm tra", verdict pass/needs_change)──▶ ai_checked
draft | ai_checked ──(editor+, verdict ≠ fail)──▶ review1 ──(teacher/admin)──▶ review2 ──(teacher/admin, gọi publish)──▶ published ──▶ retired
review1 | review2 ──(teacher/admin, bắt buộc ghi chú)──▶ draft | rejected ──▶ draft
```

- Mỗi chuyển trạng thái thêm một dòng `reviews` (`stage`, `decision`, `reviewer`, `note`, `at`).
- Chuyển trạng thái sai vai trò/sai bước → lỗi validate tiếng Việt trên field `status`.
- Editor không sửa `content` khi đang duyệt/đã phát hành; sửa khi `ai_checked` → tự quay về `draft`.
- `review2 → published`: gọi `POST /internal/content/questions/publish` (idempotent theo `externalRef`), lưu
  `publishedRef {questionId, questionVersionId, versionNo, publishedAt}`; API lỗi/chưa chạy → **không lưu**, giữ `review2`,
  báo lỗi thân thiện. Teacher/admin sửa `content` của câu `published` → publish lại → version mới.
- Nút **Gửi AI kiểm tra** (edit view) → `POST /api/questions/:id/ai-check` → task `check_question` (mock ở dev) →
  lưu `aiReport` (verdict, issues, report, ai_task_id); `fail` → giữ trạng thái, chỉ lưu báo cáo.

## Nhập liệu

- Form `content`: dạng `mcq_single`/`mcq_multi` có form có cấu trúc (đề, lựa chọn, đáp án, giải thích vi/en, evidence);
  dạng khác nhập JSON thô, nút **Chèn mẫu** lấy từ `QUESTION_FIXTURES[type].content` (`@allingo/schemas`).
- `sectionCode`: ô nhập có gợi ý từ `GET /api/questions/reference` (proxy API nội bộ, cache 60 s, fallback tĩnh TOEIC
  part1–7 + 12 dạng câu khi API chưa chạy).
- Nhập hàng loạt: trang **Nhập câu hỏi (JSON/CSV)** hoặc `POST /api/questions/import`; mẫu `samples/questions.sample.json`,
  `samples/questions.sample.csv`; mô tả cột `docs/import-template.md`.

## Đồng bộ sang catalog

| Hành động CMS | API nội bộ | Ghi chú |
| --- | --- | --- |
| Câu hỏi `review2 → published` / sửa câu đã published | `POST /internal/content/questions/publish` | `external_ref = questions.externalRef`; `created_by_email = users.apiUserEmail ?? email` |
| Bộ đề `draft → published` (teacher/admin) | `POST /internal/content/test-sets/publish` | yêu cầu mọi câu `published` và có `externalRef` |
| Nút AI kiểm tra | `POST /internal/content/questions/check` | |
| Dropdown section/topic/subskill | `GET /internal/content/reference` | fallback tĩnh |

Header xác thực: `X-Internal-Token: ${INTERNAL_API_TOKEN}`. Client: `src/lib/internal-api.ts` (timeout, lỗi thân thiện).
Media/lessons/vocab chưa đồng bộ (TODO Sprint 1: job `content.sync`).

## Cấu trúc

```
src/payload.config.ts        cấu hình Payload (postgresAdapter schemaName=cms, idType uuid, i18n vi/en, importMap baseDir=src)
src/collections/*.ts         9 collections
src/lib/{env,access,workflow,validate,import-questions,internal-api,reference}.ts   logic thuần, có test
src/endpoints/{ai-check,import-questions,reference}.ts   endpoint tuỳ biến của collection questions
src/components/*.tsx         field tuỳ biến (content, sectionCode), nút AI, trang nhập, link menu
src/app/(payload)/           layout, admin/[[...segments]], api/[...slug] theo mẫu Payload 3
scripts/seed-cms.ts          seed idempotent
```

## Giả định & lệch so với brief

- Không dùng `@allingo/config/eslint/next` trực tiếp: gói config thiếu dependency `@next/eslint-plugin-next`,
  `eslint-plugin-react-hooks`, `globals` nên import thất bại dưới pnpm strict; `eslint.config.js` ghép lại cùng bộ rule.
- Import tương đối không có đuôi `.js` (Turbopack của Next 16 không map `.js → .ts`).
- GraphQL tắt (`graphQL.disable`), chỉ dùng REST.
- `externalRef` = id (UUID) của document, gán trong `afterChange` khi tạo.
- `reviews.decision` mở rộng thêm `submit`/`retire`/`reopen` (CMS nội bộ) để ghi mọi chuyển trạng thái.
