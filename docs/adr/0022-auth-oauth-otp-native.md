# ADR-0022: OAuth/OTP tự triển khai trong `iam` thay cho Better Auth

- **Trạng thái:** Accepted (thay thế một phần ADR-0009, cập nhật ADR-0020)
- **Ngày:** 2026-11-01
- **Nguồn:** Sprint 1 – IAM đầy đủ

## Context
ADR-0009 chọn Better Auth; ADR-0020 dự kiến tích hợp Better Auth ở Sprint 1 cho đăng nhập xã hội và OTP. Khi rà ở Sprint 1:
- Better Auth tự quản lý bảng (`user`, `account`, `session`, `verification`) và route `/api/auth/*`; hợp đồng của Allingo là `POST /v1/auth/oauth/{provider}` nhận `id_token`/`code`, trả `AuthTokens` của chính mình, bảng là `iam.users/auth_identities/sessions` theo DDL.
- Dùng Better Auth phải viết adapter hai chiều và chấp nhận hai nguồn sự thật về phiên; `db:diff` sẽ lệch nếu để Better Auth tạo bảng.
- Phần khó thật sự (xác minh JWT bằng JWKS, đổi code lấy token, liên kết tài khoản) chỉ khoảng vài trăm dòng với `jose`.

## Decision
- Giữ lõi phiên của ADR-0020 (JWT HS256 15 phút + refresh xoay vòng băm SHA-256 trong `iam.sessions`).
- Lớp `OAuthProvider` trong `apps/api/src/modules/iam/oauth/`: Google (GIS id_token/code), Apple (id_token/code, client_secret ES256), Facebook (OIDC id_token hoặc code → Graph `/me` + `debug_token`), `MockOAuthProvider` cho dev/test. Thiếu env → provider tắt (503 `feature_disabled`).
- Liên kết tài khoản: identity đã có → đăng nhập; email đã xác minh trùng tài khoản khác → **không tự gộp**, trả 409 `link_required` và yêu cầu `link_password` (tài khoản có mật khẩu) hoặc `link_confirm` (tài khoản OTP/OAuth); email chưa xác minh không bao giờ dùng để khớp.
- OTP tự triển khai (`OtpService`): mã 6 số băm HMAC, Redis (degrade → bộ nhớ), 5 phút, 5 lần sai khoá 30 phút, 3 yêu cầu/15 phút; kênh email (SMTP), SMS (eSMS – stub), Zalo ZNS (stub).
- Thu hồi tức thời: denylist `sess:revoked:{sid}` (Redis, TTL = access TTL) kiểm tra trong `AuthGuard`; phát hiện tái sử dụng refresh token → thu hồi mọi phiên của user + audit.

## Alternatives considered
1. Better Auth với bảng riêng schema `auth` + đồng bộ sang `iam.*` – hai nguồn sự thật, khó kiểm toán.
2. Better Auth với custom adapter ghi thẳng `iam.*` – adapter phải mô phỏng `account/verification`, cột không khớp DDL.
3. Dịch vụ quản lý (Clerk/Auth0) – chi phí theo MAU, dữ liệu ra ngoài VN (NĐ 13/2023).

## Consequences
- Không thêm bảng, `db:diff` sạch; hợp đồng `/auth/*` đúng OpenAPI.
- Đội tự chịu trách nhiệm cập nhật khi nhà cung cấp đổi JWKS/endpoint (đã có test với provider giả lập; cần kiểm thử thật với client id trước GATE-1).
- Chưa có 2FA TOTP, passkey (ngoài phạm vi S1) – đánh giá lại khi có B2B SSO.
- CLAUDE.md §3 dòng Auth cập nhật: "Lõi auth tự triển khai (ADR-0020/0022)".
