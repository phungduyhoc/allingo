# Runbook — Yêu cầu xoá dữ liệu cá nhân

Cơ sở: CLAUDE.md §9, NĐ 13/2023/NĐ-CP (bảo vệ dữ liệu cá nhân). Luồng tự phục vụ: `DELETE /v1/me` → `iam.deletion_requests` → job
`iam.purge` sau `PURGE_DELAY_MINUTES` (72 giờ): ẩn danh hoá `iam.users`, xoá identities/sessions/consents, ghi âm & ảnh (S3/R2 qua
`PersonalDataRegistry`), ghi chú/hội thoại gia sư; GIỮ ledger billing/hoá đơn (nghĩa vụ kế toán) với user_id đã ẩn danh.

## Yêu cầu qua kênh hỗ trợ (email/Zalo)
1. Xác minh chủ tài khoản (đăng nhập hoặc OTP tới email/số đã đăng ký) – không xoá theo yêu cầu không xác minh.
2. Admin tạo yêu cầu thay người dùng (cùng luồng `DELETE /me` bằng phiên của người dùng, hoặc insert `iam.deletion_requests` + audit
   `user.deletion_requested` có admin id). Trả lời người yêu cầu: thời hạn 72 giờ, dữ liệu giữ lại vì pháp lý (hoá đơn).
3. Sau 72 giờ kiểm: `select status, purged_at from iam.deletion_requests where user_id = …`; Langfuse/PostHog: xoá theo id băm
   (`u_<hmac>` / `sha256(salt:user_id)`); Sentry không có PII (redactDeep).
4. Backup: dữ liệu trong bản sao lưu PITR (≤ 30 ngày) tự hết hạn; nếu khôi phục từ backup cũ → chạy lại `iam.purge` cho các
   `deletion_requests` đã hoàn tất (danh sách giữ trong DB) TRƯỚC khi mở lại hệ thống.
