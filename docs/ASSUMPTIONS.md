# Giả định (Sprint 0)

| # | Giả định | Lý do | Ảnh hưởng / việc cần xác nhận |
| --- | --- | --- | --- |
| A1 | Môi trường khởi tạo không có Docker daemon; PostgreSQL 16 + pgvector 0.6 và Redis 7 chạy cục bộ | Phiên Claude Code chạy trong container cloud | `compose.dev.yml` vẫn đầy đủ cho máy dev; Meilisearch/MinIO/Mailpit ở Sprint 0 được stub + unit test mock |
| A2 | Lõi xác thực tự triển khai trong `iam` (Argon2id, JWT, refresh xoay vòng, phiên khách); Better Auth tích hợp ở Sprint 1 cho OAuth/OTP | Giữ DDL `iam.*` đúng spec, `db:diff` sạch | ADR-0020; Sprint 1 viết adapter Better Auth |
| A3 | Payload CMS lưu bản soạn thảo trong schema `cms` và đồng bộ sang `catalog` khi phát hành | An toàn nhất cho Sprint 0 | ADR-0019; đánh giá lại ở Sprint 2 |
| A4 | Hạ tầng cloud chưa chốt (GATE-1) → `infra/terraform` chỉ có khung + README | Theo ADR-0014 | Sprint 1 viết module Terraform theo phương án được chọn |
| A5 | Không có API key AI → `AI_PROVIDER=mock`; adapter google/anthropic/openai được viết sẵn và chỉ kiểm tra bằng typecheck | Không có khoá trong phiên | Cần thử thật với khoá Gemini trước GATE-1 |
| A6 | Bảng quy đổi điểm TOEIC là ước tính nội bộ (tuyến tính từng đoạn) | Không có bảng chính thức | UI ghi rõ "ước tính"; hiệu chỉnh bằng dữ liệu thật ở GĐ1 |
| A7 | Audio demo Part 2 là tệp WAV tổng hợp (tone) đặt tại `apps/web/public/demo-audio`, không phải giọng đọc | Chưa có TTS thật | Sprint 2 sinh audio bằng Azure TTS qua `SpeechProvider` |
| A8 | Ghim TypeScript 5.9 / ESLint 9 / Vitest 4 thay vì TS 7 / ESLint 10 / Vitest 5 | Tương thích toolchain | ADR-0021; rà lại mỗi quý |
| A9 | Quota/giá/credit trong seed là giá trị tạm theo PRD mục 4; đổi trong admin trước khi bán | Chưa chốt giá | Sprint 7 |
| A10 | `attempts.expires_at`, `question_order` không có cột riêng trong DDL → lưu trong `attempts.draft_state` (JSONB) | Giữ DDL | Nếu cần index theo hạn nộp, đề xuất cột mới ở `docs/SPEC-ISSUES.md` |
| A11 | CMS dùng `externalRef` = UUID do CMS sinh làm khoá idempotent khi phát hành sang catalog (`question_versions.metadata.external_ref`) | Payload không có id ổn định trước khi lưu lần đầu | Khi đổi sang ID nghiệp vụ (vd. `cms:q:<n>`) cần migrate metadata |
| A12 | CMS import nhận JSON/CSV qua body text (không multipart) để không cần cấu hình upload trong Payload custom endpoint | Đơn giản cho Sprint 0 | Sprint 2 chuyển sang upload tệp + job `content.import` |
| A13 | `reviews.decision` trong CMS có thêm giá trị `send_back`, `request_changes` ngoài approve/reject để phản ánh luồng duyệt 2 lớp | PRD chỉ nêu duyệt/từ chối | Không ảnh hưởng catalog (chỉ trạng thái nội bộ CMS) |
| A14 | PWA: `@serwist/next` chỉ hỗ trợ webpack, Next 16 build bằng Turbopack → service worker đóng gói riêng bằng esbuild (`apps/web/scripts/build-sw.mjs`), precache shell tĩnh | Giữ Turbopack (build nhanh hơn ~5 lần) | Rà lại khi Serwist hỗ trợ Turbopack |
| A15 | Cache giải thích AI dùng chung giữa mọi người học theo (question_version_id, chosen_option, locale); Exam Mode được kiểm tra trước cache | Tiết kiệm credit theo thiết kế kỹ thuật | UX hiển thị nhãn "đã có sẵn"; cân nhắc cá nhân hoá theo `learner_level` ở Sprint 5 |
