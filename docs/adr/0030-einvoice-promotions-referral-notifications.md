# ADR-0030: Hoá đơn điện tử (MISA meInvoice – Proposed), khuyến mãi đầy đủ có giữ lượt, referral qua outbox, NotificationService đa kênh

- **Trạng thái:** Proposed cho **nhà cung cấp hoá đơn** (chốt khi ký hợp đồng – MISA meInvoice mặc định, Viettel SInvoice dự phòng);
  Accepted cho phần còn lại (pipeline hoá đơn, khuyến mãi, referral, thông báo)
- **Ngày:** 2026-11-02
- **Nguồn:** Sprint 8 (chi tiết hoá ADR-0011 credit ledger, ADR-0012 webhook-first, ADR-0029 billing; CLAUDE.md §5.5–§5.7, §5.11, §5.12, §9)

## Context
- Mỗi đơn đã thanh toán phải có hoá đơn điện tử (NĐ 123/2020, sửa đổi NĐ 70/2025) phát hành qua nhà cung cấp được Tổng cục Thuế
  chấp thuận; phiên phát triển không có hợp đồng/tài khoản test của nhà cung cấp nào.
- Khuyến mãi S7 chỉ validate mã cố định, lượt dùng chỉ tính đơn đã trả (có thể vượt `max_uses` khi đua – A100); S8 cần loại
  `credit_bonus`/`trial_days`, điều kiện người dùng mới/chương trình, không cộng dồn, trial một lần/người.
- Referral cần nối ba sự kiện của ba module (iam `user.registered`, test-engine `attempt.graded`, billing `order.paid`) và chống lạm dụng.
- Thông báo S7 chỉ in-app; S8 cần email/push/in-app theo mẫu i18n, tuỳ chọn theo loại, giờ yên lặng, giới hạn tần suất, huỷ đăng ký.
- DDL v1.0 thiếu cột: điều kiện khuyến mãi, bảng lượt dùng, mã giới thiệu của người dùng, tuỳ chọn theo loại.

## Decision
1. **Nhà cung cấp hoá đơn (Proposed):** interface `EInvoiceProvider` (`issue`, `cancel`, `getPdf`, `getStatus`) trong billing;
   `MisaMeInvoiceProvider` (API tích hợp meInvoice v2 – `auth/token` → `invoice` SignType HSM → `invoice/download` PDF base64 →
   `invoice/cancel`; viết theo tài liệu công khai, **chưa chạy với tài khoản thật**), `ViettelSInvoiceProvider` (khung, ném
   `not_implemented`), `MockEInvoiceProvider` (dev/test: số tăng dần, mã tra cứu băm, PDF tối thiểu tự dựng – không thêm thư viện).
   Chọn bằng `EINVOICE_PROVIDER`; mock bị chặn ở production; thiếu credential không âm thầm rơi về mock (lỗi → dead-letter).
   Lý do chọn MISA mặc định: API REST JSON tài liệu công khai, ký HSM phía nhà cung cấp (không cần USB token ở server), phổ biến với
   doanh nghiệp SaaS nhỏ; Viettel tương đương về pháp lý – quyết định cuối theo giá/hợp đồng.
2. **Pipeline hoá đơn:** `order.paid` (local + outbox) → `billing.invoices` `pending` (ảnh chụp người mua trong cột `buyer`) → job
   `invoice.issue` (JobsService, hàng `maintenance`, jobId mỗi lần thử một id) → PDF lưu bucket riêng `invoices` (URL ký 10 phút khi
   đọc `GET /orders/{id}`) → `issued` + outbox `invoice.issued` → growth gửi email kèm PDF. Thử lại theo backoff 1/5/15/60/240 phút
   do **DB điều khiển** (`raw.attempts/next_retry_at`, job `invoice.retry` mỗi phút) – chạy đúng cả inline lẫn BullMQ; hết 6 lần →
   `failed` + `ops.jobs_deadletter` + outbox `invoice.failed` (admin in-app/email, `OPS_ALERT_EMAIL`). Admin thử lại từ dead-letter.
   Hoàn tiền → `cancel_pending` → job `invoice.cancel` (cùng cơ chế). Giữ quyền xử lý bằng `raw.issuing_until` (nhiều worker);
   `refId = order_id` để nhà cung cấp chống phát hành trùng. Đối chiếu tháng: hoá đơn hiệu lực = đơn paid − refunded.
3. **Khuyến mãi:** `billing.promotions` thêm `conditions jsonb`, `stackable` (luôn false), `name`; `kind` ∈ percent | fixed |
   credit_bonus | trial_days (CHECK; `amount` → `fixed`). Bảng mới `billing.promotion_redemptions` (reserved → redeemed | released):
   POST /orders khoá hàng mã `FOR UPDATE` + giữ lượt trong cùng transaction tạo đơn (không vượt `max_uses` khi đua); đơn chờ cũ của
   chính người dùng cùng mã bị thay thế; thanh toán → redeemed (+ credit_bonus vào ledger `promo`); hết hạn → released.
   `POST /promotions/redeem` cho trial_days (subscription `trialing`, entitlements nguồn `trial`, không credit; UNIQUE partial một
   lần/người) và credit_bonus standalone. Hàm đánh giá thuần `evaluatePromotion` (thứ tự lý do cố định).
4. **Referral:** growth sở hữu nghiệp vụ trên bảng `iam.referrals` (thêm `blocked_reason`, `metadata`, `started_at`, `upgraded_at`);
   mã giới thiệu `iam.users.referral_code` cấp lười qua `UsersService` (iam). Chuỗi joined → started → upgraded qua consumer outbox
   (local + relay, idempotent). Thưởng hai chiều ở mốc started và upgraded theo `ff.growth.referral.rules.config` (mặc định 200/200,
   500/500), ledger `referral`. Chống lạm dụng: fingerprint thiết bị (client gửi `X-Device-Fingerprint`, server chỉ lưu sha256) /
   IP trùng phiên người giới thiệu (self_referral), fingerprint trùng lượt khác (duplicate_device), IP trùng lượt khác của cùng người
   giới thiệu (duplicate_ip) trong 24 giờ; trần `monthly_cap` lần thưởng/tháng/người giới thiệu; chưa xác minh → bỏ qua, cấp bù ở mốc sau.
5. **NotificationService** (growth): `send(userId, template, data, {channels, dedupeKey, emailTo, attachments})`; mẫu Handlebars
   vi/en trong repo (TS, không tệp .hbs), email HTML + plain-text trong layout có link quản lý/huỷ đăng ký; adapter email `smtp`
   (Mailpit dev) / `ses` (giao diện SMTP) / `resend` (HTTP) / `memory`; push qua `NotificationsService.pushToUser` (S6); in-app
   `ops.notifications` + Socket.IO `notification.new`. Chính sách thuần `decideDelivery`: kênh tắt → loại tắt (trừ email/in-app giao
   dịch) → tần suất (≤ 1 email marketing/7 ngày, ≤ 2 push không giao dịch/ngày) → giờ yên lặng giờ VN cho push (defer/skip/ignore
   theo mẫu; hàng `scheduled` được job `notification.dispatch` giao). Mỗi kênh một hàng; bỏ qua ghi `cancelled` + lý do.
   Huỷ đăng ký: token HMAC (`v1.<user>.<category|all>.<sig>`, không hết hạn), GET không đổi trạng thái (302 trang quản lý web),
   POST one-click RFC 8058. `UserDirectory` (shared) đảo phụ thuộc để billing đọc tên/email người mua mà không import iam.
6. **Free credit tháng (A105):** job `credit.grant_free_monthly` cấp `plans['free'].credits_included` mỗi tháng lịch VN cho tài khoản
   đăng ký không có gói trả phí, lô hết hạn đầu tháng sau (không cộng dồn), idempotent theo (user, kỳ) qua ref_id dẫn xuất kỳ.

## Alternatives considered
- Retry bằng BullMQ `attempts/backoff`: không chạy khi JOBS_INLINE (dev) và mất lịch khi Redis mất; DB-driven rõ ràng, quan sát được.
- Lượt khuyến mãi chỉ tính đơn đã trả (S7): đơn giản nhưng vượt `max_uses` khi đua và cho người dùng giữ nhiều đơn giảm giá.
- Referral code tất định từ user_id (không cột mới): không tra ngược được mã ngắn; cột UNIQUE rẻ và rõ.
- Bảng tuỳ chọn thông báo riêng theo (user, category, channel): linh hoạt hơn nhưng JSONB `categories` đủ cho 3 × 3 và giữ một hàng/người.
- Render HTML→PDF bằng Chromium cho mock: nặng, chỉ phục vụ dev; PDF tối thiểu tự dựng đủ cho kiểm thử tải/đính kèm.

## Consequences
- Migration 0005 (+ DDL tham chiếu v1.1): 99 bảng. Hợp đồng API v1.1 thêm 16 đường dẫn (135), mở rộng tương thích Order/Promotion/
  NotificationPreferences/NotificationItem/ReferralSummary.
- Hoá đơn thật cần: hợp đồng + tài khoản test MISA, ký hiệu hoá đơn đăng ký với CQT, xác nhận thuế suất (mặc định KCT) và quy trình
  huỷ/điều chỉnh khi hoàn tiền với kế toán (runbook invoices §2, §5).
- Email thật cần domain gửi có SPF/DKIM/DMARC (runbook invoices §7); push cần VAPID (S6).
- Thêm loại thông báo = thêm một mục `NOTIFICATION_TEMPLATES` (vi/en) + mã vào `NOTIFICATION_TEMPLATE_CODES`; web thêm bản dịch in-app.
