# Runbook — Hoá đơn điện tử, email giao dịch & thông báo

Phạm vi: Sprint 8 (ADR-0030). Module `apps/api/src/modules/billing/invoices` (hoá đơn), `apps/api/src/modules/growth/notify`
(email/push/in-app). Bảng `billing.invoices`, `ops.jobs_deadletter`, `ops.notifications`, `ops.notification_preferences`.
Thao tác admin cần vai trò `admin`/`superadmin`.

> Trạng thái kiểm chứng: chỉ `MockEInvoiceProvider` chạy end-to-end trong phiên phát triển. `MisaMeInvoiceProvider` viết theo tài
> liệu công khai "meInvoice API tích hợp" (v2, 2024) và được kiểm bằng HTTP giả lập – CHƯA gọi tài khoản test thật. Viettel SInvoice
> chỉ là khung. Trước khi bán thật phải làm mục 2 và có xác nhận của kế toán ở mục 5.

## 1. Luồng chuẩn

```
order.paid (webhook) ──► billing.invoices (pending, ảnh chụp buyer) ──► job invoice.issue (hàng maintenance)
   ──► EInvoiceProvider.issue(refId = order_id) ──► getPdf ──► storage bucket `invoices` <yyyy>/<mm>/<order>.pdf
   ──► invoices.status = issued (+ series, invoice_no, lookup_code) ──► outbox invoice.issued
   ──► growth: email "Hoá đơn điện tử …" kèm PDF (tới buyer_info.email, nếu không có → email tài khoản) + in-app
lỗi ──► status error, raw.next_retry_at (+1/5/15/60/240 phút) ──► job invoice.retry (mỗi phút) ──► … hết 6 lần
   ──► status failed + ops.jobs_deadletter + outbox invoice.failed ──► admin in-app/email + OPS_ALERT_EMAIL
hoàn tiền (POST /admin/orders/{id}/refund) ──► order.refunded ──► issued → cancel_pending → job invoice.cancel → cancelled
   (chưa phát hành → skipped; đang phát hành dở → khi xong thấy đơn refunded → cancel_pending)
```

- Người mua: `POST /orders` nhận `buyer_info` – cá nhân (`name`, `email` tuỳ chọn – thiếu dùng hồ sơ) hoặc doanh nghiệp
  (`tax_code` MST 10/13 số có chữ số kiểm tra, `company`, `address` bắt buộc). Không log tên/email/MST/địa chỉ.
- Web hiển thị `GET /orders/{id}.invoice`: `status`, `series`, `invoice_no`, `lookup_code`, `lookup_url`, `pdf_url` (ký 10 phút –
  gọi lại để lấy URL mới), `issued_at`, `cancelled_at`.
- Job: `invoice.issue`, `invoice.cancel` (mỗi lần thử một jobId `<order>-i<n>`), `invoice.retry` (bộ lập lịch billing 60 s – quét
  backoff đến hạn, hàng `pending` kẹt > 10′, đơn paid 7 ngày chưa có hoá đơn). Chạy tay: `POST /v1/admin/billing/jobs/invoice.retry`.

## 2. Bật MISA meInvoice (khi có hợp đồng)

1. Đăng ký tài khoản test meInvoice (testapi.meinvoice.vn), tạo **ứng dụng tích hợp** lấy `appid`; đăng ký **ký hiệu hoá đơn** với CQT
   (vd `1C26TAA`: 1 = HĐ GTGT, C = có mã CQT, 26 = năm, T = doanh nghiệp đăng ký, AA tự đặt).
2. Key Vault / `.env`: `EINVOICE_PROVIDER=misa`, `MISA_MEINVOICE_BASE_URL`, `MISA_MEINVOICE_APP_ID`, `MISA_MEINVOICE_TAX_CODE`,
   `MISA_MEINVOICE_USERNAME`, `MISA_MEINVOICE_PASSWORD`, `MISA_MEINVOICE_INV_SERIES`, `MISA_MEINVOICE_SIGN_TYPE` (2 = HSM của MISA),
   `EINVOICE_VAT_RATE` (mục 5). Redeploy API + worker.
3. Kiểm thử bằng một đơn sandbox giá thấp, xác nhận và ghi lại vào ADR-0030 các điểm còn giả định:
   - tên trường kết quả phát hành (`TransactionID`, `InvNo`, `InvSeries`, `ErrorCode`) và mã lỗi trùng `RefID`;
   - `invoice/download?downloadDataType=pdf` trả mảng `{TransactionID, Data(base64)}`;
   - thân `invoice/cancel` (`TransactionID`, `InvNo`, `RefDate`, `CancelReason`) và trạng thái `invoice/status`;
   - URL tra cứu công khai (`https://www.meinvoice.vn/tra-cuu/?sc=<mã>`).
4. Đổi nhà cung cấp không ảnh hưởng hoá đơn cũ: mỗi hàng `billing.invoices.provider` giữ nhà cung cấp đã phát hành (huỷ/tải lại PDF
   dùng đúng provider đó).

## 3. Dead-letter & xử lý sự cố

| Triệu chứng | Kiểm tra | Xử lý |
| --- | --- | --- |
| Đơn paid > 10′ chưa có hoá đơn | `GET /v1/admin/billing/invoices?order_id=` (status, attempts, last_error, next_retry_at) | Chờ backoff hoặc `POST /v1/admin/billing/jobs/invoice.retry` |
| `last_error = not_configured` | Thiếu credential nhà cung cấp | Sửa cấu hình (mục 2), rồi thử lại từ dead-letter |
| Mã lỗi dữ liệu (invalid/required) | Thông tin người mua sai (MST/tên) | Sửa `billing.orders.buyer_info` + `billing.invoices.buyer` (SQL có kiểm duyệt, ghi audit tay), rồi thử lại |
| Dead-letter có mục mới | `GET /v1/admin/billing/dead-letters?job=invoice.issue` | Sửa nguyên nhân → `POST /v1/admin/billing/dead-letters/{id}/retry` (200 + `outcome.status`) |
| Hoàn tiền nhưng hoá đơn chưa huỷ | `status = cancel_pending`, dead-letter `invoice.cancel` | Thử lại; nếu nhà cung cấp không cho huỷ → lập hoá đơn điều chỉnh trên portal (mục 5) và ghi chú |

- Thử lại từ dead-letter đặt lại bộ đếm (6 lần mới), audit `invoice.dead_letter_retry` (admin id); thành công → `payload.resolved_at`.
- Phát hành thành công nhưng lỗi khi tải PDF/lưu: `raw.provider_ref` đã có → lần sau không phát hành lại, chỉ tải PDF.
- Không bao giờ sửa tay `invoice_no`/`series` – số do nhà cung cấp cấp.

## 4. Đối chiếu tháng

`GET /v1/admin/billing/invoices/reconciliation?month=2026-11` (theo `paid_at`, lịch Asia/Ho_Chi_Minh):
`expected_invoices = orders_paid − orders_refunded` phải bằng `invoices_issued`; `missing` (đơn paid chưa có hoá đơn phát hành),
`unexpected` (đơn đã hoàn tiền còn hoá đơn hiệu lực). Làm trước ngày 20 tháng sau (kỳ khai thuế GTGT tháng) cùng kế toán; số liệu
khớp với báo cáo tình hình sử dụng hoá đơn trên portal nhà cung cấp.

## 5. Thuế & quy trình cần kế toán xác nhận (chưa chốt)

- `EINVOICE_VAT_RATE` mặc định `KCT` (không chịu thuế – dịch vụ giáo dục/phần mềm). Nếu kế toán xác định chịu thuế, đặt `8`/`10`
  (giá bán đã gồm thuế; hệ thống tách thuế, làm tròn đồng). Đổi thuế suất chỉ áp cho hoá đơn phát hành sau thời điểm đổi.
- Hoàn tiền → hệ thống gọi **huỷ** hoá đơn theo sprint. Theo NĐ 123/2020 (sửa đổi NĐ 70/2025), hoá đơn đã gửi người mua/CQT có thể
  phải **điều chỉnh/thay thế** thay vì huỷ – kế toán quyết định; nếu cần, đổi `invoice.cancel` thành phát hành hoá đơn điều chỉnh giảm.
- Người mua cá nhân không cung cấp tên: hoá đơn ghi "Khách lẻ" (MISA `BuyerFullName`).

## 6. Bucket `invoices`

- Riêng tư (không public, không CDN); chỉ URL ký `S3_PRESIGN_TTL_SECONDS` (10′). Tên bucket `S3_BUCKET_INVOICES`.
- Lưu ít nhất 10 năm (Luật Kế toán – chứng từ kế toán) → lifecycle **không** xoá; bật versioning + chặn xoá (object lock) trên R2/S3.
- Xoá tài khoản (`DELETE /me`) KHÔNG xoá hoá đơn (nghĩa vụ kế toán – A22); dữ liệu người mua trong `billing.invoices.buyer` giữ nguyên.

## 7. Email: nhà cung cấp, SPF/DKIM/DMARC

- `EMAIL_PROVIDER`: `smtp` (Mailpit dev :1025 – xem thư tại http://localhost:8025), `ses` (Amazon SES qua SMTP
  `email-smtp.<region>.amazonaws.com:587`, `SES_SMTP_USER/PASS`), `resend` (`RESEND_API_KEY`), `memory` (test). `SMTP_FROM` là người gửi.
- Domain gửi (vd `mail.allingo.vn`), cấu hình DNS trước khi gửi thật:
  - **SPF**: `mail.allingo.vn TXT "v=spf1 include:amazonses.com ~all"` (SES) hoặc `include:_spf.resend.com` (Resend); một bản ghi SPF/tên.
  - **DKIM**: SES Easy DKIM → 3 CNAME `<token>._domainkey.mail.allingo.vn → <token>.dkim.amazonses.com`; Resend → TXT `resend._domainkey`
    theo giá trị trang domain. Khoá 2048 bit, xoay năm/lần.
  - **DMARC**: `_dmarc.allingo.vn TXT "v=DMARC1; p=quarantine; rua=mailto:dmarc@allingo.vn; adkim=s; aspf=s"` (bắt đầu `p=none` 2 tuần,
    theo dõi báo cáo rồi nâng).
  - MAIL FROM tuỳ chỉnh (SES): `bounce.mail.allingo.vn MX 10 feedback-smtp.<region>.amazonses.com` + SPF tương ứng.
  - Kiểm tra: gửi tới mail-tester.com / Gmail "Show original" → SPF/DKIM/DMARC = PASS.
- Email không giao dịch có `List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (Gmail/Yahoo bắt buộc với người
  gửi số lượng lớn từ 2024). Bounce/complaint: SES → SNS → (S9) tắt `channels.email` của người dùng; tạm thời theo dõi trên console.
- Không log địa chỉ email/nội dung – chỉ chủ đề + loại adapter (`mailer`), và `ops.notifications` (không lưu địa chỉ người nhận).

## 8. Thông báo: tuỳ chọn, giờ yên lặng, tần suất

- Loại × kênh: `categories.{learning,billing,marketing}.{email,push,inapp}` (`PATCH /me/notification-preferences` hoặc trang quản lý bằng
  token). Marketing email mặc định theo đồng ý marketing lúc đăng ký. Email/in-app giao dịch (biên lai, hoá đơn, cảnh báo admin) luôn gửi.
- Giờ yên lặng (giờ VN, mặc định 22:00–07:00) chỉ áp cho push: nhắc học bị bỏ; nhắc gia hạn/hết hạn/trial được hẹn tới giờ kết thúc
  (`ops.notifications.status = scheduled`) và job `notification.dispatch` (mỗi phút) giao. Giới hạn: ≤ 1 email marketing/7 ngày,
  ≤ 2 push không giao dịch/ngày.
- Huỷ đăng ký: link trong email `GET /v1/notifications/unsubscribe?token=` → 302 trang quản lý web; one-click `POST` cùng URL.
  Token ký HMAC (`NOTIFY_UNSUBSCRIBE_SECRET`, trống → dẫn xuất từ `AUTH_SECRET`); xoay khoá làm link cũ hết hiệu lực → chỉ xoay khi lộ.
- Tra cứu một người dùng: `select channel, template_code, status, error, scheduled_at, sent_at from ops.notifications where user_id = … order by scheduled_at desc` (`error = skipped:<lý do>` khi bị bỏ qua).
