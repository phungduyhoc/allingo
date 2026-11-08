# Runbook – Vận hành beta kín (S12)

Phạm vi: mở beta TOEIC L&R theo mã mời, kênh phản hồi (góp ý in-app, báo lỗi câu, ticket), SLA hỗ trợ, NPS, báo cáo tuần.
Liên quan: ADR-0035, `docs/analytics/events.md`, `docs/gates/beta-weekly-*.md`, API nhóm Admin (OpenAPI v1.1 – S12).

## 1. Bật beta gate

1. Kiểm tra cờ: `GET /v1/admin/flags/ff.growth.beta_gate` (vai trò admin, phiên đã step-up MFA).
2. Cấu hình đợt (ghi đè mặc định trong `rules.config`):
   ```json
   PUT /v1/admin/flags/ff.growth.beta_gate
   { "enabled": true, "rules": { "user_ids": [], "config": { "daily_invite_limit": 50, "trial_days": 60, "credits": 2000, "invite_ttl_days": 14, "credit_valid_days": 90 } } }
   ```
3. Hiệu lực < 60 s trên mọi replica (pub/sub `ff:invalidate`). Khi bật: người dùng chưa có quyền beta gọi API app → 403 `beta_required`;
   landing/catalog công khai, đăng nhập, `/me` tối thiểu, xoá dữ liệu, đổi mã, hỗ trợ vẫn chạy.
4. Cho người nội bộ/đối tác vào không cần mã: thêm `user_id` vào `rules.user_ids` (allowlist) – hoặc cấp vai trò `beta_tester`
   (`POST /v1/admin/users/{id}/roles {"role_code":"beta_tester"}`).

## 2. Mời theo đợt

1. Xem danh sách chờ: `GET /v1/admin/beta/waitlist?program=toeic&status=waiting` (email đã che).
2. Chọn người (giữ thứ tự chọn = thứ tự gửi): `POST /v1/admin/beta/invites {"waitlist_entry_ids": [...], "batch": "dot-1"}` → `queued`.
3. **Trước khi gửi – kiểm tra SMTP (B6/S153).** Dev/local: chạy `pnpm docker:up` để có Mailpit (SMTP `localhost:1025`, hộp thư
   xem tại http://localhost:8025) – `.env` mặc định `SMTP_HOST=localhost`, `SMTP_PORT=1025`. Staging/production: `SMTP_*` (hoặc nhà
   cung cấp email) đã cấu hình trong Key Vault và gửi thử thành công (`POST /v1/admin/notifications/test` kênh email tới hộp thư nội
   bộ). Không có SMTP → mỗi lần gửi lỗi, lời mời quay về `queued` và tốn một lượt thử (`send_attempts`; 3 lần → `failed`, phải mời
   lại) – vì vậy không bấm "Gửi ngay" khi chưa có SMTP.
4. Gửi: job `beta.invites_send` tự chạy mỗi ngày lúc `BETA_INVITE_SEND_HOUR_VN` (09:00 giờ VN), tối đa `daily_invite_limit`/ngày;
   chạy tay: `POST /v1/admin/beta/invites/send {"limit": 50}` (mọi lời mời đang xếp hàng, cũ trước). Chỉ gửi một lô (B6/S147):
   `{"batch": "dot-1"}` (lời mời đang chờ của đợt) hoặc `{"invite_ids": ["…", "…"]}` (đúng các lời mời đã chọn, theo thứ tự truyền
   vào; trang admin: tab Lời mời → tích chọn → "Gửi đã chọn"); hạn mức ngày luôn được tôn trọng, `result.skipped` = lời mời được chọn
   nhưng không còn `queued`. Lỗi SMTP → trả về `queued` (thử lại lần sau), 3 lần → `failed`.
5. Theo dõi: `GET /v1/admin/beta/invites?status=sent` (`today.remaining`), tỉ lệ đổi mã trong báo cáo tuần.
6. Thu hồi mã chưa dùng: `POST /v1/admin/beta/invites/{id}/revoke`.
7. Mã chỉ có trong email (DB lưu sha256). Người dùng báo mất mã → thu hồi rồi mời lại (mã mới).

Kế hoạch S12: đợt 1 (50) → theo dõi 3 ngày (lỗi chặn học = 0, SLO đạt) → đợt 2–6 (≤ 50/ngày) tới 300 người.

## 3. Hàng đợi phản hồi

| Kênh | Nguồn | Nơi xử lý | SLA |
| --- | --- | --- | --- |
| Góp ý in-app (`ops.feedback`) | Nút "Góp ý" (ảnh màn hình + `trace_id`); cả trên `/beta` cho người chưa có mã (chỉ chữ – B6/S150) | `GET /v1/admin/feedback` → tra trace trong Tempo/Loki theo `trace_id` | phân loại trong 1 ngày làm việc |
| Báo lỗi câu (`ops.content_reports`) | Nút "Báo lỗi câu hỏi" | CMS → "Nội dung › Báo lỗi câu hỏi" (đồng bộ 30 s) hoặc `GET /v1/admin/content/reports` | **48 giờ** |
| Ticket (`ops.support_tickets`) | Trang Hỗ trợ (kể cả người chưa vào được app) | `GET /v1/admin/support/tickets?overdue=true` | **phản hồi đầu 24 giờ** |

Quy trình báo lỗi câu: Mở → biên tập viên kiểm tra → sửa câu trong CMS (phiên bản mới qua workflow 2 lớp) → đổi trạng thái
"Đã sửa" (hoặc "Từ chối" kèm ghi chú). Người báo nhận thông báo in-app. ≥ 3 báo cáo mở trên một câu → thống kê câu gắn `review`;
≥ 5 báo cáo xác nhận → đề xuất `retire` (`GET /v1/admin/content/questions/stats?recommendation=retire`).

Trả lời ticket: `POST /v1/admin/support/tickets/{id}/messages {"message": "...", "channels": ["inapp","email"], "status": "waiting_user"}`;
cấp credit bù cùng lúc: thêm `"credit": {"delta": 200, "note": "Bù lỗi audio Part 3"}` (ledger `admin_adjust`, audit `user.grant_credits`).

<a id="sla"></a>
## 4. SLA

- Job `ops.sla_check` (15′/lần) cập nhật gauge `support_sla_overdue{kind="content_report"|"support_ticket"}`; alert
  `SupportSlaBreached` (ticket, 30′) khi > 0.
- Xử lý: mở danh sách quá hạn (`?overdue=true`), phân công (`PATCH /v1/admin/support/tickets/{id} {"assigned_to": "<admin id>"}`),
  trả lời trước rồi mới điều tra sâu. Báo lỗi câu chưa sửa kịp → đổi "Xác nhận lỗi" (dừng đồng hồ SLA phía người học) + ghi chú dự kiến.
- Lỗi "chặn học" (không làm/nộp được bài, mất điểm) → ưu tiên `urgent`, không để mở > 48 giờ (tiêu chí GATE-2).

## 5. Tài khoản & quyền

- Khoá: `POST /v1/admin/users/{id}/lock {"reason": "..."}` → mọi phiên thu hồi ngay (denylist Redis, fallback DB); mở: `/unlock`.
- Xem như người dùng (điều tra ticket): `POST /v1/admin/users/{id}/impersonate {"reason": "ticket #..."}` → token CHỈ ĐỌC 10 phút
  (Bearer), mọi request ghi audit `impersonation.request`. Không dùng để thao tác thay người dùng.
- Xoá dữ liệu theo yêu cầu (đã xác minh danh tính qua ticket): `POST /v1/admin/users/{id}/deletion {"reason": "..."}` (72 giờ).
- Tra nhật ký: `GET /v1/admin/audit-logs?action=user.&entity_id=<id>` (tiền tố khi kết thúc bằng `.`/`*`).

## 6. NPS & báo cáo tuần

- Khảo sát onboarding 5 câu sau khi đổi mã; NPS in-app ngày 7 (hiển thị ngày 7–13) và ngày 14 (14–27) – `GET /me/surveys/pending`.
- Thứ Hai: `pnpm report:beta` (tuần trước) → `docs/gates/beta-weekly-<YYYY-Www>.md`; `--email` gửi `BETA_REPORT_EMAILS`.
  Không có PostHog key → mục PostHog ghi "chưa có". Đối chiếu số với PostHog/DB (±2 %) trước khi đưa vào GATE-2.
- Dữ liệu giả lập để thử báo cáo: `pnpm db:seed --set beta-demo` (KHÔNG chạy trên staging/production; báo cáo tự gắn nhãn
  "DỮ LIỆU GIẢ LẬP"); xoá: `--reset` tạo lại, hoặc xoá user `@beta-demo.allingo.test`.

## 7. MFA admin

- Bắt buộc ở staging/production (`ADMIN_MFA_REQUIRED=auto`). Admin mới: đăng nhập → `POST /v1/auth/mfa/totp/enroll` → quét
  `otpauth_url` → `POST /v1/auth/mfa/totp/confirm {"code"}` → lưu 10 mã khôi phục (hiện MỘT lần).
- Mỗi phiên mới: `POST /v1/auth/mfa/verify {"code"}` (hiệu lực `MFA_SESSION_MAX_AGE_HOURS`, mặc định 12 giờ, refresh giữ).
- Mất thiết bị: dùng mã khôi phục, rồi `POST /v1/auth/mfa/recovery-codes {"code"}` khi có thiết bị mới. Mất cả hai → superadmin xoá
  hàng `iam.mfa_factors` của người đó (ghi audit thủ công) để đăng ký lại.
