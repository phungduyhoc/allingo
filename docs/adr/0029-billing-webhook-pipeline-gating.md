# ADR-0029: Pipeline thanh toán webhook-first (mã tham chiếu suy ra đơn, khoá đơn), bảng gating dùng chung, job billing

- **Trạng thái:** Accepted
- **Ngày:** 2026-11-02
- **Nguồn:** Sprint 7 – đơn hàng, VNPay/MoMo/ZaloPay, subscription, entitlement gating, đối soát (chi tiết hoá ADR-0010, ADR-0011, ADR-0012; CLAUDE.md §5.5–§5.7, §5.12)

## Context
- Ba cổng VN khác nhau về chữ ký (VNPay HMAC-SHA512 query sắp xếp + `vnp_Amount × 100`, MoMo HMAC-SHA256 chuỗi raw theo thứ tự trường,
  ZaloPay mac key1 khi tạo / key2 khi callback), cách gọi IPN (VNPay GET, MoMo/ZaloPay POST JSON) và định dạng phản hồi (RspCode, 204, return_code).
- IPN có thể đến trước khi `/pay` trả về, đến nhiều lần, đồng thời, sau khi đơn hết hạn, hoặc mất hẳn.
- Gating Sprint 0–6 rải `FEATURE_CODES.*` + `entitlements.require` + `quotas.consume/refund` trong từng module; web tự đoán khoá/mở.
- DDL không có cột mã tham chiếu cổng, metadata đối soát; ưu tiên không thêm migration.

## Decision
1. **`PaymentProvider`** (`createPayment`, `verifyWebhook`, `parseWebhook`, `ack`, `verifyReturn`, `queryStatus`, `refund?`) + adapter
   `VnpayProvider` (2.1.0), `MomoProvider` (AIO v2), `ZalopayProvider` (v2), `MockPaymentProvider` (dev/test, chặn ở production).
   Cổng khả dụng = có trong `PAYMENT_PROVIDERS` VÀ đủ credential; không khả dụng thì không liệt kê (`GET /payments/providers`).
2. **Mã tham chiếu** = base36(order_id) 25 ký tự + nonce 6 (31 ký tự): mỗi `/pay` một mã mới (cổng cấm trùng), suy ra `order_id` không cần
   hàng `initiated`; lưu trong `payments.raw_callback.merchant_ref` (JSONB sẵn có).
3. **Xác nhận một transaction, khoá `orders` FOR UPDATE** → tuần tự hoá mọi xác nhận cùng đơn; idempotent theo UNIQUE
   `(provider, provider_txn_id)` (chặn cuối 23505 → duplicate). Thứ tự: payments → orders.paid → `FulfillmentService.grant`
   (subscription + entitlements + credit qua `CreditService`) → promotions.used_count → outbox `order.paid` → audit. Đơn hết hạn/thất bại
   nhưng tiền đã trừ → vẫn cấp (`late`); trả lần 2 → ghi nhận, không cấp lại, audit để hoàn tiền tay; sai số tiền → không cấp.
   Return URL chỉ đọc trạng thái DB. `payment.reconcile` dùng đúng đường `confirm` với nguồn `queryStatus`.
4. **Gia hạn = mua lại**: subscription mới nối tiếp cuối kỳ cùng gói (mỗi đơn ↔ một subscription → hoàn tiền thu hồi đúng kỳ của đơn).
   Credit tháng theo cửa sổ 30 ngày từ đầu kỳ, idempotent theo số dòng `subscription_grant` của subscription (khoá hàng subscription).
   Gói credit: lô `purchase` hết hạn 12 tháng; phân bổ tiêu/hết hạn/hoàn tiền bằng phát lại ledger FIFO theo hạn (`credit-lots.ts`).
5. **Bảng gating `packages/config/entitlements.ts`** (`FEATURE_GATES`: entitlement, quota, quota theo phạm vi, tác vụ credit, nội dung miễn phí)
   – tệp TS thuần, được `@allingo/schemas` bundle (tsup) để API/web dùng ở runtime mà không kéo dependency ESLint của `@allingo/config`.
   `FeatureGateService` (billing) là cửa duy nhất: `check` (403 upgrade) / `consume` (429 quota, vé `release()` hoàn lượt) / `locked` (UI).
6. **Job billing** đăng ký `JobsService` (hàng `maintenance`) + bộ lập lịch theo chu kỳ trong worker (API khi `JOBS_INLINE`/`BILLING_SCHEDULER_IN_API`),
   khoá Redis theo nhịp chống chạy trùng giữa replica. Thông báo hết hạn/nhắc gia hạn: billing ghi outbox `subscription.*` → growth tạo
   `ops.notifications` in-app (chống trùng theo `dedupe_key`).

## Alternatives considered
- Cột `payments.merchant_ref` + migration: rõ hơn nhưng S7 ưu tiên JSONB sẵn có; tra theo `order_id` (có index) + JSONB đủ nhanh.
- Gia hạn tại chỗ (kéo dài `current_period_end`): mất liên kết đơn ↔ kỳ khi hoàn tiền.
- Bảng gating trong `@allingo/schemas` trực tiếp: sprint yêu cầu `packages/config`; bundle giữ một nguồn duy nhất.

## Consequences
- Không mất giao dịch khi trình duyệt đóng hoặc IPN mất (reconcile 15′); không cấp trùng khi IPN lặp/đồng thời (test Promise.all).
- Adapter chỉ được kiểm bằng vector chữ ký tự tạo – phải chạy sandbox thật trước khi bán (runbook `docs/runbooks/payments.md` §2).
- Thêm tính năng trả phí = thêm một dòng `FEATURE_GATES` + gọi `FeatureGateService`; web đọc cùng bảng.
