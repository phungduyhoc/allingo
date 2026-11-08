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

<a id="backlog"></a>
## 2. Tồn đọng
1. Worker sống? `az containerapp replica list -n allingo-stg-worker`; log `worker started`, `backpressure: low-priority workers paused`.
2. Redis đầy/`noeviction` → `redis-down.md`. BullMQ cần `maxmemory-policy noeviction`.
3. Scale worker (min replicas) – `grading` concurrency 4/replica; job AI chậm do provider → `ai-provider.md`.
4. Backpressure kéo dài (notify dừng) → thông báo trễ: chấp nhận được trong giờ thi; nếu > 1 giờ, tăng worker grading.
