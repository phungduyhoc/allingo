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
| A16 | Hạ tầng theo phương án B – Azure Container Apps (Southeast Asia) + Cloudflare R2/DNS/WAF; chưa có tài khoản cloud → Terraform chỉ `validate`/`plan`, chưa `apply` | GATE-1 chưa chốt | ADR-0023 (Proposed); đổi sang A chỉ ảnh hưởng `infra/terraform/modules/compute` |
| A17 | Không dùng Better Auth; OAuth/OTP tự triển khai bằng `jose` | Hợp đồng `/auth/oauth/{provider}` và DDL `iam.*` không khớp mô hình của Better Auth | ADR-0022 |
| A18 | Cả 3 provider có adapter; provider thiếu env → 503 `feature_disabled`, web ẩn nút (Google cần `NEXT_PUBLIC_GOOGLE_CLIENT_ID`) | Chưa có client id trong phiên | Anh điền `GOOGLE_CLIENT_ID` để thử thật; Apple cần tài khoản developer |
| A19 | OTP nhận `phone` **hoặc** `email`, thêm kênh `email` (Mailpit ở dev); Zalo ZNS và eSMS là stub, dev in mã ra log | Sprint prompt yêu cầu OTP email; hợp đồng gốc chỉ có phone | SPEC-ISSUES S11; nối API thật ở S8 |
| A20 | Phát hiện tái sử dụng refresh token lưu hash token trước trong `iam.sessions.device->>'_prev_rt'` | DDL không có cột riêng | SPEC-ISSUES S12; `/me/sessions` lọc khoá nội bộ |
| A21 | Đồng ý điều khoản: `accept_terms` thiếu (client cũ/mobile) được coi là đã hiển thị văn bản đồng ý; `false` → 400. OAuth/OTP tạo tài khoản ghi terms+privacy theo `POLICY_VERSION` | Tương thích client Sprint 0 | Văn bản Điều khoản/Chính sách là bản dự thảo – pháp chế duyệt trước GATE-3 |
| A22 | Xoá tài khoản: giữ hàng `iam.users` đã ẩn danh hoá (email `deleted+<id>@anonymized.invalid`) vì `billing.credit_ledger/orders` tham chiếu và phải lưu theo luật; xoá identities/sessions/consents/notes/chat/recordings (cả tệp S3); giữ attempts dưới id ẩn danh | PDPL + nghĩa vụ kế toán | Xuất dữ liệu (`export_url`) làm ở S8 |
