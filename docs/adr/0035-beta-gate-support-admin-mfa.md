# ADR-0035: Beta kín theo mã mời, kênh phản hồi & hỗ trợ, admin vận hành, MFA step-up cho admin

- **Trạng thái:** Accepted
- **Ngày:** 2026-11-08
- **Nguồn:** Sprint 12 – Beta kín 300 người, admin & vận hành, phân tích (CLAUDE.md §5, §8, §9; pentest-1 việc mở F9–F11)

## Context
- S12 mở beta TOEIC cho 300 người theo mã mời (đợt ≤ 50/ngày), cần chặn người chưa có mã khỏi API app nhưng vẫn cho xem landing,
  đăng nhập, xoá dữ liệu, liên hệ hỗ trợ. DDL v1.0 không có bảng mời/danh sách chờ; spec gợi ý `billing.promotions` + danh sách email
  trong `feature_flags.payload` (không có cột `payload`; promotions trial_days chỉ một lần/người và không mang credit).
- Cần kênh phản hồi đo được (góp ý kèm ảnh + trace, báo lỗi câu → CMS, ticket SLA 24 giờ), admin tổng hợp (khoá tài khoản, xem như
  người dùng có audit, thống kê câu, DLQ), job vận hành (thống kê câu, retention, báo cáo đối soát) và báo cáo KPI tuần.
- Pentest-1: admin chỉ có mật khẩu; mật khẩu tối thiểu 8 ký tự không kiểm danh sách lộ; `InternalTokenGuard` so sánh `!==`.

## Decision
1. **Bảng mới trong `ops`** (giữ 6 schema – ADR-0003; module growth sở hữu): `waitlist_entries` (email citext, unique (email,
   program)), `beta_invites` (mã `ALG-XXXX-XXXX` – chỉ lưu sha256, trạng thái queued → sent → redeemed/expired/revoked/failed, một
   người đổi một mã), `survey_responses` (onboarding 5 câu JSONB + NPS ngày 7/14). Quyền lợi beta (Pro trial `<program>_pro_monthly`
   60 ngày + 2.000 credit ledger `promo`/`beta_invite`) cấp qua `BetaGrantService` của billing trong cùng transaction đổi mã – không
   dùng `billing.promotions` để không chiếm lượt trial 7 ngày và không lẫn số liệu khuyến mãi.
2. **Beta gate** = cờ `ff.growth.beta_gate` (`enabled` = gate bật, `rules.user_ids` = allowlist, `rules.config` = hạn mức/quyền lợi)
   + `BetaGateGuard` toàn cục sau AuthGuard: endpoint `@Public` và `@BetaExempt` không bị chặn; quyền = vai trò nội bộ/`beta_tester`
   (JWT) hoặc vai trò `beta_tester` trong DB (cache Redis 5′/30 s – có hiệu lực ngay sau khi đổi mã, không cần refresh). 403
   `beta_required` (mã lỗi mới).
3. **Phản hồi & hỗ trợ**: `ops.feedback` (ảnh = media asset riêng tư của chính người gọi, `trace_id` tự gắn), `ops.content_reports`
   (+ message/SLA 48 giờ; catalog sở hữu; CMS collection `content-reports` là bản sao kéo theo `updated_at` qua `/internal/content-reports`,
   đổi trạng thái trong CMS gọi API trước – API là nguồn sự thật), `ops.support_tickets` (+ SLA 24 giờ) + `ops.support_messages` (2 chiều);
   trả lời admin qua NotificationService (`support.reply`) và cấp credit bù bằng `CreditService.adjust` trong cùng transaction. Job
   `ops.sla_check` → gauge `support_sla_overdue` + alert.
4. **Admin**: tìm/hồ sơ người dùng PII che (`maskEmail`), khoá = `status suspended` + `revokeAll` (denylist Redis ngay), impersonate =
   JWT 10 phút `scope=read_only` + `imp=<admin>` (sid riêng, không refresh): AuthGuard chặn mọi phương thức ghi và `/admin/*`, ghi audit
   TRƯỚC khi chạy handler (fail-closed); DLQ chung + replay (cột `job_name`, `replay_count`); tìm audit (partition pruning theo khoảng
   thời gian, tiền tố action); thống kê câu CTT (p-value, point-biserial phần còn lại – `corr()` trên replica) lưu
   `catalog.questions.stats`; retention do admin điều phối, mỗi module tự xoá bảng của mình.
5. **MFA TOTP tự cài** (RFC 6238/4226, không thêm thư viện, test vector RFC): chỉ admin/superadmin; secret AES-256-GCM
   (`MFA_ENCRYPTION_KEY`), chống replay theo bước, 10 mã khôi phục băm, khoá 15′ sau 5 lần sai. **Step-up theo phiên**
   (`iam.sessions.mfa_verified_at` + claim `mfa`, refresh giữ trong `MFA_SESSION_MAX_AGE_HOURS`) thay vì đổi luồng đăng nhập – áp được
   cho mật khẩu/OAuth/OTP như nhau, không đổi hợp đồng `/auth/login`. Endpoint có `@Roles` → admin chưa step-up nhận 403 `mfa_required`
   (bắt buộc ở staging/production – `ADMIN_MFA_REQUIRED=auto`).
6. **Mật khẩu**: ≥ `PASSWORD_MIN_LENGTH` (12) + danh sách lộ offline (top-N quốc tế + mẫu VN + biến thể từ gốc/hậu tố) + ký tự lặp/dãy/
   chứa email; HIBP k-anonymity tuỳ chọn (fail-open). So sánh token nội bộ hằng thời gian.
7. **Báo cáo KPI**: `computeBetaKpis` (SQL trên replica, READ ONLY) dùng chung cho `pnpm report:beta` (Markdown `docs/gates/`) và
   `GET /admin/reports/beta`; PostHog HogQL khi có personal key. Dữ liệu giả lập: seed `beta-demo` (không mặc định, nhãn rõ).

## Consequences
- (+) Beta gate tắt/bật/allowlist < 60 s, không cần deploy; quyền lợi beta idempotent và đối soát được qua ledger.
- (+) Mọi hành động admin nhạy cảm có audit; impersonate không thể ghi; khoá có hiệu lực tức thì.
- (−) Waitlist/invite nằm ở `ops` (không phải `growth` schema) – nếu tách dịch vụ growth sau này cần chuyển bảng.
- (−) CMS kéo dữ liệu (30 s) thay vì đẩy realtime; chấp nhận được với SLA 48 giờ.
- (−) Trial beta dùng entitlement nguồn `trial` → người dùng beta không đổi được thêm trial 7 ngày (khuyến mãi) – chấp nhận (A196).
- Theo dõi: crash-free (Sentry Release Health API) và Web Vitals (PostHog) chưa nối vào báo cáo – cần key thật.
