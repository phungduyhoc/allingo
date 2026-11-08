# Runbook — Hàng đợi tắc / dead-letter (BullMQ)

Alert: `DeadLetterJobs` (DLQ > 0), `QueueBacklog` (> 500 job chờ hoặc job chờ > 10′). Dashboard "Hàng đợi". Hàng đợi: `grading` >
`content` / `media` > `notify` / `analytics` / `maintenance` (S11 backpressure: `grading` ≥ `QUEUE_BACKPRESSURE_GRADING_DEPTH` (200) job chờ
→ worker `notify`, `analytics` tạm dừng tới khi ≤ 100; gauge `bullmq_worker_paused`).

## 1. Dead-letter
```sql
select queue, job_id, attempts, failed_at, left(error, 200) from ops.jobs_deadletter order by failed_at desc limit 50;
```
1. Nhóm theo `error` – lỗi do dữ liệu (một bản ghi) hay hệ thống (provider/DB)? Span lỗi: Tempo theo `queue.process <job>` (trace nối
   từ request tạo job qua `_traceparent`).
2. Sửa nguyên nhân (deploy/hotfix/cấu hình), rồi replay: hoá đơn → `POST /v1/admin/billing/invoices/dead-letters/{id}/retry`; job khác
   (S12): `GET /v1/admin/jobs/dead-letters?queue=&replayed=false` → `POST /v1/admin/jobs/dead-letters/{id}/replay` (xoá job thất bại cũ
   trong BullMQ rồi thêm lại cùng jobId; Redis/worker không sẵn → chạy inline trong API; audit `job.dead_letter_replayed`, `replay_count`).
   Job không xác định được tên/handler → 409 `no_handler` → xử lý tay. Dòng DLQ đã replay/giải quyết được `ops.retention_cleanup` xoá sau
   `RETENTION_DEADLETTER_DAYS` (90 ngày). Trạng thái tổng: `GET /v1/admin/system/status` (độ sâu hàng đợi, DLQ, partition, outbox).
3. Không replay mù job thanh toán/credit – kiểm ledger trước (`payments.md` §5).

<a id="outbox"></a>
## 1b. Outbox (B7/S26 – ADR-0036)
Consumer sự kiện miền lỗi → chỉ consumer đó được thử lại theo backoff (10 s·2^(n−1), trần 1 giờ, `OUTBOX_MAX_ATTEMPTS` = 10 lần) →
quá hạn (hoặc `OutboxPermanentError`) vào `ops.jobs_deadletter` với `queue = 'outbox'`, `job = event_type` (alert `DeadLetterJobs`
cùng gauge `bullmq_deadletter_jobs{queue="outbox"}`). Theo dõi: `outbox_backlog_events{state}`, `outbox_consumer_failures_total{consumer}`,
`GET /v1/admin/system/status` → `outbox.retrying | dead_lettered | oldest_unpublished_sec`.
```sql
select id, event_type, attempts, pending_consumers, left(last_error, 200), next_attempt_at, dead_lettered_at
from ops.outbox where published_at is null and (attempts > 0 or dead_lettered_at is not null) order by id desc limit 50;
```
1. `last_error` dạng `<Class.method>: <thông điệp>` → tìm consumer, sửa nguyên nhân (provider, dữ liệu, deploy).
2. Replay: trang Admin → Hệ thống → Dead-letter (lọc queue `outbox`) hoặc `POST /v1/admin/jobs/dead-letters/{id}/replay` – giao NGAY các
   consumer còn lỗi (consumer đã thành công không chạy lại); kết quả `delivered | retry | already_delivered`. Lỗi lại → vòng thử lại mới.
3. Lỗi tạm thời đang thử lại không cần thao tác; muốn thử ngay: `update ops.outbox set next_attempt_at = now() where id = …`.

<a id="backlog"></a>
## 2. Tồn đọng
1. Worker sống? `az containerapp replica list -n allingo-stg-worker`; log `worker started`, `backpressure: low-priority workers paused`.
2. Redis đầy/`noeviction` → `redis-down.md`. BullMQ cần `maxmemory-policy noeviction`.
3. Scale worker (min replicas) – `grading` concurrency 4/replica; job AI chậm do provider → `ai-provider.md`.
4. Backpressure kéo dài (notify dừng) → thông báo trễ: chấp nhận được trong giờ thi; nếu > 1 giờ, tăng worker grading.
