# Runbook — Thanh toán (VNPay · MoMo · ZaloPay) & billing

Phạm vi: Sprint 7 (ADR-0012 webhook-first, ADR-0029). Module `apps/api/src/modules/billing`. Bảng `billing.*`, sự kiện `ops.outbox`,
nhật ký `ops.audit_logs`. Mọi thao tác admin dưới đây cần vai trò `admin`/`superadmin` (cookie hoặc Bearer).

> Trạng thái kiểm chứng: adapter 3 cổng viết theo tài liệu chính thức (VNPay 2.1.0, MoMo AIO v2, ZaloPay v2) và được kiểm bằng
> **vector chữ ký tự tạo** (`apps/api/test/fixtures/payments/vectors.json`, HMAC tính độc lập bằng `openssl`). CHƯA chạy với
> sandbox thật — lần đầu có credential phải làm mục 2 trước khi bật cổng cho người dùng.

## 1. Luồng chuẩn

```
web /pricing → POST /v1/orders (Idempotency-Key) → POST /v1/orders/{id}/pay {provider}
   → redirect_url | qr_code | deeplink → người dùng trả ở cổng
   → cổng gọi IPN  /v1/webhooks/payments/{provider}  (VNPay: GET; MoMo/ZaloPay: POST JSON)
        xác minh chữ ký → 1 transaction: payments → orders.paid → subscription/entitlements/credit → outbox order.paid
   → cổng chuyển trình duyệt về /v1/payments/return/{provider} → 302 web /checkout/result?order_id=&status=
        (CHỈ hiển thị; web polling GET /v1/orders/{id} hoặc nghe Socket.IO `order.updated`)
```

Trạng thái đơn: `pending → paid | failed | cancelled | expired`, `paid → refunded` (admin). Đơn `failed|cancelled` còn hạn
gọi `/pay` lại được (về `pending`, mã tham chiếu mới). Hết hạn sau `ORDER_EXPIRE_MINUTES` (30′).

Job (worker, hàng đợi `maintenance`; dev không có worker → API tự chạy khi `JOBS_INLINE=true` hoặc `BILLING_SCHEDULER_IN_API=true`):

| Job | Chu kỳ | Việc |
| --- | --- | --- |
| `order.expire` | 1′ | đơn pending/failed/cancelled quá `expires_at` → `expired` |
| `payment.reconcile` | 5′ | lần thanh toán `initiated` > `PAYMENT_RECONCILE_AFTER_MINUTES` (15′, ≤ 48 giờ) → `queryStatus`; paid → cấp quyền như webhook |
| `subscription.expire` | 10′ | hết kỳ → `expired`/`cancelled` + thông báo; nhắc trước 7/3/1 ngày |
| `credit.grant_monthly` | 1 giờ | cấp credit kỳ 30 ngày đến hạn (idempotent theo subscription × kỳ) |
| `credit.expire` | 1 giờ | lô gói credit quá 12 tháng → ledger `expire` phần còn lại |
| `billing.reconcile` | 01:30 VN | đối soát hôm qua qua `queryStatus` cho mọi cổng khả dụng (không ghi đè lần chạy đã có) |
| `credit.grant_free_monthly` | 1 giờ | S8: Free nhận `plans['free'].credits_included` (300) mỗi tháng lịch VN, lô hết hạn đầu tháng sau (không cộng dồn) |
| `invoice.retry` | 1′ | S8: hoá đơn điện tử thử lại theo backoff, hàng kẹt, đơn paid thiếu hoá đơn – xem `docs/runbooks/invoices.md` |

Chạy tay: `POST /v1/admin/billing/jobs/{job}` (200 + kết quả nếu xong trong 10 s, ngược lại 202).

## 2. Cấu hình & bật cổng sandbox

Biến môi trường (xem `.env.example`; giá trị thật chỉ ở Key Vault/`.env` cục bộ, KHÔNG commit):

| Cổng | Biến | Lấy ở đâu |
| --- | --- | --- |
| VNPay 2.1.0 | `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET`, `VNPAY_PAY_URL`, `VNPAY_API_URL` | email đăng ký sandbox.vnpayment.vn (merchant admin) |
| MoMo AIO v2 | `MOMO_PARTNER_CODE`, `MOMO_ACCESS_KEY`, `MOMO_SECRET_KEY`, `MOMO_ENDPOINT`, `MOMO_REQUEST_TYPE` | business.momo.vn → môi trường test |
| ZaloPay v2 | `ZALOPAY_APP_ID`, `ZALOPAY_KEY1`, `ZALOPAY_KEY2`, `ZALOPAY_ENDPOINT` | merchant ZaloPay (sandbox) |
| chung | `PAYMENT_PROVIDERS=vnpay,momo,zalopay`, `PAYMENT_CALLBACK_BASE_URL` | URL https công khai mà cổng gọi về (sandbox: tunnel ngrok/cloudflared tới API :4000) |

Cổng chỉ "khả dụng" khi có trong `PAYMENT_PROVIDERS` VÀ đủ credential; thiếu → không có trong `GET /v1/payments/providers`
(web ẩn nút), `/pay` → 503 `feature_disabled`, webhook → 404. `mock` luôn bị chặn ở production.

Đăng ký URL ở cổng: IPN `https://<callback-base>/v1/webhooks/payments/{vnpay|momo|zalopay}`; return
`https://<callback-base>/v1/payments/return/{provider}` (MoMo/ZaloPay nhận trong từng request; VNPay cấu hình IPN URL ở merchant admin).

Kiểm thử lần đầu với sandbox (mỗi cổng): mua `toeic_pro_monthly` → quyền mở < 5 s sau IPN, ledger có dòng `subscription_grant`
`period=0` với `balance_after` đúng; gửi lại IPN (công cụ của cổng) → `RspCode 02`/`return_code 2`/204 và vẫn chỉ 1 payment;
sửa 1 ký tự chữ ký → HTTP 400 + audit `payment.webhook_rejected`. Ghi kết quả vào HANDOFF; nếu lệch tài liệu (vd thứ tự trường
chữ ký querydr VNPay), sửa adapter + vector.

Cờ `ff.billing.checkout` (bật/tắt bán hàng, có luật `user_ids` cho tester):
`PUT /v1/admin/flags/ff.billing.checkout {"enabled": false, "rules": {"user_ids": ["<uuid tester>"]}}`.

## 3. Đơn kẹt (người dùng báo "đã trừ tiền nhưng chưa có Pro")

1. Tìm đơn: `GET /v1/admin/billing/orders?user_id=<uuid>` (hoặc `status=pending`). Xem `payments[]`: `provider_txn_id`, `merchant_ref`, `status`.
2. `status = initiated` (chưa có IPN): chạy `POST /v1/admin/billing/jobs/payment.reconcile` (job hỏi `queryStatus`; chỉ lấy lần
   thanh toán > 15′). Đơn `paid` sau đó là xong — quyền + credit cấp trong cùng transaction, outbox `order.paid`.
3. Cổng xác nhận đã trừ tiền nhưng `queryStatus` không thấy: kiểm tra `merchant_ref` trong cổng (VNPay `vnp_TxnRef`, MoMo `orderId`,
   ZaloPay `app_trans_id = yymmdd_<merchant_ref>`). Không sửa tay bảng `billing.*`; gửi lại IPN từ công cụ của cổng.
4. Đơn đã `expired` nhưng IPN thành công đến muộn → hệ thống VẪN cấp quyền (`order.paid` có `late = true`, audit).
5. Đơn đã `paid` nhưng có thêm giao dịch thành công khác (trả 2 lần): audit `payment.duplicate_order_payment`, payment
   `success` có `raw_callback.duplicate_order_payment = true` → hoàn tiền giao dịch thừa ở cổng (thủ công), không cần sửa DB.
6. Sai số tiền (`payment.amount_mismatch`): KHÔNG cấp quyền; liên hệ cổng đối chiếu, hoàn tiền ở cổng nếu đã trừ.

Truy vấn hữu ích (read-only):

```sql
-- IPN bị từ chối 24 giờ qua
select created_at, after->>'provider' provider, after->>'reason' reason, ip from ops.audit_logs
 where action = 'payment.webhook_rejected' and created_at > now() - interval '24 hours' order by created_at desc;
-- đơn pending quá 15 phút
select o.id, o.user_id, o.created_at, p.provider, p.raw_callback->>'merchant_ref' ref from billing.orders o
  join billing.payments p on p.order_id = o.id and p.status = 'initiated'
 where o.status = 'pending' and o.created_at < now() - interval '15 minutes';
```

## 4. Hoàn tiền (thủ công – S7)

1. Hoàn tiền cho khách ở cổng (merchant portal) hoặc chuyển khoản; lưu mã hoàn tiền của cổng.
2. `POST /v1/admin/orders/{orderId}/refund {"reason": "<lý do + mã hoàn tiền cổng>", "revoke_credits": true}`:
   đơn → `refunded`; subscription của đơn kết thúc ngay, entitlements hết hiệu lực (cache Redis xoá); credit còn lại của đơn
   (gói credit hoặc credit tháng của subscription) → ledger `refund` âm; phần đã tiêu không thu hồi (không làm số dư âm) –
   hiện ở `revoked.credits_shortfall` và `note` của ledger. Audit `order.refund`, outbox `order.refunded`.
3. Chỉ đơn `paid` hoàn được (khác → 409). Chưa gọi API hoàn tiền tự động của cổng (`PaymentProvider.refund`) – làm tay ở bước 1.
4. S8: hoá đơn điện tử của đơn tự chuyển `cancel_pending → cancelled` (job `invoice.cancel`); credit tặng kèm đơn (credit_bonus,
   lô `promo` ref `promotion:<order>`) còn lại cũng bị thu hồi (ledger `refund`, không làm số dư âm); lượt mã vẫn tính là đã dùng.
   Xem `docs/runbooks/invoices.md` §1, §3.

## 5. Đối soát

Hằng ngày 01:30 giờ VN: `billing.reconcile` (queryStatus) cho ngày hôm qua → `billing.reconciliation_runs` (`matched|mismatched|error`).
Đối soát bằng sao kê: tải CSV từ portal cổng, chuyển về mẫu dưới rồi gửi:

```bash
curl -X POST "$API/v1/admin/billing/reconciliations" -H "Authorization: Bearer $ADMIN" -H 'content-type: application/json' \
  -d "$(jq -n --arg csv "$(cat vnpay-2026-11-01.csv)" '{provider:"vnpay", for_date:"2026-11-01", source:"csv", csv:$csv}')"
```

Mẫu CSV (UTF-8, dòng tiêu đề, phân cách `,` hoặc `;`, ô có thể đặt trong `"…"`):

```
provider_txn_id,merchant_ref,amount,currency,status,paid_at
14226112,8gy4lkao5r8pe2w0c7ovtqmovabc123,199000,VND,success,2026-11-01T10:18:00+07:00
```

- `amount` là VND (KHÔNG nhân 100 kể cả VNPay; `199000` hoặc `199000.00`; không dùng dấu chấm phân cách nghìn).
- `status`: `success|paid|00|thành công` → success; `refunded|hoàn tiền` → refunded; còn lại failed (dòng failed không tính "thừa").
- Bí danh cột chấp nhận: VNPay `vnp_TransactionNo, vnp_TxnRef, vnp_Amount_vnd`; MoMo `transId, orderId`; ZaloPay `zp_trans_id,
  app_trans_id` (tiền tố `yymmdd_` tự bỏ); chung `txn_id, so_tien, trang_thai`.
- Khớp theo `provider_txn_id` rồi `merchant_ref`. Lệch: `missing_in_statement` (hệ thống có, sao kê không), `missing_in_system`
  (sao kê có, hệ thống không → kiểm tra mục 3), `amount_mismatch`, `status_mismatch`.
- Báo cáo: `GET /v1/admin/billing/reconciliations/{runId}` (JSON) hoặc `?format=csv` (tải danh sách lệch).
  Chạy lại cùng cổng × ngày ghi đè (UNIQUE). Nguồn/số dòng của mỗi lần chạy ở audit `billing.reconciliation_run`.

## 6. Xoay khoá webhook / credential

1. Tạo khoá mới ở portal cổng (VNPay hash secret, MoMo secret key, ZaloPay key1/key2). Cổng áp khoá mới cho request ký sau thời điểm đổi.
2. Cập nhật Key Vault → redeploy API **và** worker cùng lúc (cả hai ký/kiểm chữ ký). Không có giai đoạn chấp nhận hai khoá:
   IPN ký bằng khoá cũ trong vài phút chuyển giao sẽ bị 400 → cổng tự gửi lại (VNPay/MoMo/ZaloPay đều retry); nếu vẫn sót,
   `payment.reconcile` (queryStatus) bắt lại trong 15′.
3. Sau 30′ chạy `POST /v1/admin/billing/jobs/payment.reconcile` và kiểm tra audit `payment.webhook_rejected` không còn tăng.
4. `PAYMENT_MOCK_SECRET` chỉ dùng dev/test; production chặn mock.

## 7. Cổng giả lập (dev/E2E)

`PAYMENT_PROVIDERS=mock` → `/pay {provider:"mock"}` trả `redirect_url = /v1/payments/mock/checkout?ref=…` (trang có nút
Thành công / Thất bại / Huỷ / "Thành công nhưng mất webhook"). Nút gửi webhook ký `x-mock-signature` như cổng thật rồi 303 về
`/v1/payments/return/mock` → web. "Mất webhook" để thử `payment.reconcile` (chạy job tay sau 15′, hoặc sửa `created_at` trong dev).
Webhook tay: `POST /v1/webhooks/payments/mock` thân `{ref, txn_id, amount, currency:"VND", status:"paid"}`, header
`x-mock-signature = HMAC-SHA256(PAYMENT_MOCK_SECRET, "ref|txn_id|amount|currency|status")` (hex).

## 8. Mã lỗi cho client

| HTTP | `error.code` | Khi nào |
| --- | --- | --- |
| 400 | `validation_failed` | thiếu Idempotency-Key, giá không hợp lệ, mã giảm không áp dụng (`details.promotion.reason`), return_url ngoài web |
| 403 | `forbidden` | tài khoản khách mua (`details.reason = guest_account`); tính năng cần nâng cấp (`details = {feature, program, gate, upgrade: true}`) |
| 402 | `insufficient_credits` | thiếu credit cho tác vụ AI |
| 409 | `conflict` | Idempotency-Key dùng lại khác body; đơn không trả được (`order_not_payable`); hoàn tiền đơn chưa paid; huỷ lifetime |
| 429 | `quota_exceeded` | hết lượt (`details.quota = {feature, period, limit, used, remaining, resets_at}`) |
| 502 | `payment_failed` | cổng từ chối tạo thanh toán / lỗi mạng (`details.provider_code`) |
| 503 | `feature_disabled` | `ff.billing.checkout` tắt hoặc cổng không khả dụng (`details.flag = payments.<provider>`) |
