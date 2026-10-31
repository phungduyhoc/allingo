# Vấn đề phát hiện trong docs/spec (đề xuất sửa, chưa tự ý đổi hợp đồng)

| # | Tệp | Vấn đề | Xử lý trong Sprint 0 | Đề xuất |
| --- | --- | --- | --- | --- |
| S1 | `allingo-schema.sql` dòng 1142 | Index `ix_entitlements_user_valid ... WHERE valid_to IS NULL OR valid_to > now()` không hợp lệ (predicate dùng hàm không IMMUTABLE, lỗi 42P17 khi tạo) | Đã sửa thành `CREATE INDEX ... ON billing.entitlements(user_id, feature_code, valid_to)` trong cả spec và migration 0001 (v1.0.1) | Cập nhật tệp spec trong Project |
| S2 | `allingo-schema.sql` | `learn.attempts` không có cột hạn nộp (`expires_at`), thứ tự câu (`question_order`), `time_limit_sec` | Lưu trong `attempts.draft_state` JSONB (`AttemptDraftState`), job hết hạn quét bằng `draft_state->>'expires_at'` | Cân nhắc thêm `expires_at timestamptz` + index partial khi làm job `attempt.expire` (Sprint 3) |
| S3 | `allingo-openapi.yaml` | `Attempt` thiếu `expires_at`/`ui_state`; `ReviewItem` thiếu `score`, `time_spent_ms`, `flagged`, `details`, `community_correct_rate`; `AttemptSummary` thiếu `status`, `raw_score`, `started_at` | API trả thêm các trường này (mở rộng tương thích, không bỏ trường nào) | Bổ sung vào YAML ở Sprint 3 |
| S4 | `allingo-openapi.yaml` | `POST /auth/guest` chỉ trả `guest_token`/`expires_at`; cần cả `user` và access token để client gọi API ngay | Trả thêm `user` và đặt cookie/bearer như `AuthTokens` | Sửa YAML Sprint 1 |
| S5 | `allingo-openapi.yaml` | Thiếu endpoint cấp vai trò (admin) và endpoint `GET /admin/questions` chưa dùng ở Sprint 0 | Chưa làm | Sprint 1–2 |
| S6 | `allingo-prompts.yaml` | `model_policy.primary` dùng alias (`google:gemini-flash`) chưa có bảng ánh xạ alias → model id | Ánh xạ trong `apps/api/src/modules/ai-gateway/model-router.ts` qua env `GEMINI_FLASH_MODEL`... | Ghi bảng alias vào spec (mục `shared.model_aliases`) |
| S7 | `allingo-schema.sql` | Seed `catalog.question_types.content_schema` trỏ `schemas/question/<code>.json` nhưng Zod là nguồn sự thật | Seed core ghi thêm `package`/`export` để tra cứu | Cập nhật ghi chú trong spec |
