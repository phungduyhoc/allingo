# ADR-0036: Outbox giao theo consumer – thử lại có backoff, giới hạn số lần, dead-letter và replay

- **Trạng thái:** Accepted
- **Ngày:** 2026-11-09
- **Nguồn:** Backlog B7 – độ bền hệ thống (SPEC-ISSUES S26, T10 của HANDOFF); bổ sung ADR-0006 (outbox), ADR-0027 (JobsService), ADR-0035 (DLQ admin)

## Context
- Relay cũ (`OutboxService.relayBatch`) đọc hàng chưa `published_at`, phát `outbox.<event>` qua EventEmitter2 rồi **luôn** đánh dấu
  published. `@OnEvent` của `@nestjs/event-emitter` mặc định `suppressErrors: true` → lỗi của consumer bị nuốt (chỉ log Nest), sự kiện
  coi như đã giao: không thử lại, không dead-letter, không metric. Nhiều consumer cùng một sự kiện (`attempt.graded` có 7) nên thử lại
  cả sự kiện sẽ chạy lại consumer đã thành công (cộng XP/ghi sổ lỗi hai lần).
- Nhiều replica worker cùng relay một hàng (SELECT không khoá) → có thể giao trùng.
- Admin đã có trang Hệ thống/DLQ (S12) cho `ops.jobs_deadletter` + replay job BullMQ.

## Decision
1. **Giao theo từng consumer.** Lúc khởi động `OutboxService` khám phá (DiscoveryService + `EVENT_LISTENER_METADATA`) mọi phương thức
   `@OnEvent('outbox.…')` của provider/controller singleton; định danh ổn định `<Class>.<method>`. Relay gọi trực tiếp từng consumer (lỗi
   của consumer này không chặn consumer khác) – **không còn phát `outbox.*` qua EventEmitter2** (tránh giao hai lần); `emitLocal`/`local.*`
   giữ nguyên. Consumer lập trình (script/test) dùng `OutboxService.subscribe(pattern, id, handler)`.
2. **Trạng thái trên chính hàng outbox** (migration 0010 – bảng partition, ADD COLUMN không ghi lại bảng): `attempts`, `next_attempt_at`
   (backoff/lease), `last_error`, `pending_consumers text[]` (NULL = tất cả), `dead_lettered_at`. Lần lỗi chỉ lưu các consumer còn lỗi →
   lần thử sau chỉ gọi chúng (**idempotent theo consumer**). Cập nhật theo `id` (sequence duy nhất; JS Date không giữ micro giây của
   `created_at`).
3. **Giữ chỗ an toàn nhiều replica:** `SELECT … FOR UPDATE SKIP LOCKED` + đặt `next_attempt_at = now() + OUTBOX_LEASE_SECONDS` (300 s)
   trong một transaction ngắn, giao ngoài transaction; process chết giữa chừng → hết lease relay khác nhận lại.
4. **Backoff mũ có trần:** `OUTBOX_RETRY_BASE_SECONDS · 2^(n−1)` (10 s, trần `OUTBOX_RETRY_MAX_SECONDS` 1 giờ), tối đa
   `OUTBOX_MAX_ATTEMPTS` (10 – ≈ 1,4 giờ) → **dead-letter**: một hàng `ops.jobs_deadletter` (`queue = 'outbox'`, `job_id = outbox__<id>`,
   `job_name = event_type`, payload = bản chụp sự kiện + consumer lỗi + lỗi từng consumer) và `dead_lettered_at` trên hàng outbox (relay
   bỏ qua). Consumer ném `OutboxPermanentError` → dead-letter ngay (lỗi dữ liệu không thử lại).
5. **Replay:** `POST /admin/jobs/dead-letters/{id}/replay` với `queue = outbox` → mở lại hàng (attempts 0, chỉ consumer lỗi) và giao ngay
   trong process API; đã giao → `already_delivered`; hàng outbox đã bị dọn → giao từ bản chụp. Lỗi lại → vòng thử lại mới ở worker.
   Audit `job.dead_letter_replayed`, `replay_count + 1` như DLQ BullMQ. Trang admin Hệ thống/DLQ dùng lại (lọc `queue = outbox`).
6. **Quan sát:** `outbox_events_total{event_type,result=delivered|retry|dead_letter}`, `outbox_consumer_failures_total{consumer,kind}`,
   gauge `outbox_backlog_events{state=pending|retrying|dead_letter}`, `outbox_oldest_pending_seconds`; `bullmq_deadletter_jobs{queue="outbox"}`
   (alert `DeadLetterJobs` có sẵn); log pino `outbox consumer failed` (warn) / `outbox event dead-lettered` (error) – không payload.
   `GET /admin/system/status.outbox` thêm `retrying`, `dead_lettered` (`unpublished` không tính dead-letter).

## Consequences
- Consumer lỗi giờ được **thử lại** (trước đây bị nuốt) – consumer phải chịu được chạy lại sau lỗi của chính nó (đa số đã idempotent theo
  khoá nghiệp vụ: thông báo `dedupe_key`, XP theo attempt, hoá đơn theo đơn). Consumer tự `catch` lỗi (log rồi bỏ qua) vẫn được coi là thành
  công như trước.
- Consumer đổi tên/xoá ở bản deploy mới mà còn trong `pending_consumers` → bỏ qua có log cảnh báo (không thử lại vô hạn).
- Consumer chỉ có ở một process (module không nạp ở worker) chỉ được giao bởi process đó – như trước (relay chạy ở worker).
- Không thêm thư viện; không đổi hợp đồng API (chỉ thêm trường ở `AdminSystemStatus.outbox` và mô tả replay).
- Tác vụ bắt buộc chắc chắn (xoá dữ liệu cá nhân) vẫn không dựa vào outbox (`PersonalDataRegistry`, S26 gốc).
