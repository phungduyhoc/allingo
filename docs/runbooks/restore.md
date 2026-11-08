# Runbook — Sao lưu & khôi phục PostgreSQL (PITR), Redis, object storage

Mục tiêu (Thiết kế kỹ thuật §9, S11): **RTO ≤ 1 giờ, RPO ≤ 15 phút**. Liên quan: `infra/terraform/modules/postgres` (Azure Flexible
Server, PITR 30 ngày), `infra/terraform/modules/redis`, `infra/terraform/modules/storage` (R2 lifecycle 90/365), alert `PostgresDown`,
`DiskUsageHigh`. Script diễn tập: `infra/scripts/pitr-drill.sh`.

## 1. Kết quả diễn tập thật (S11, 02/11/2026 – máy phiên, PostgreSQL 16.15 cục bộ)

Phương pháp: WAL lưu liên tục bằng **`pg_receivewal --synchronous` qua replication slot** (giống Barman streaming) + `pg_basebackup -X stream`
→ khôi phục vào **cluster tạm** (cổng 5440, socket riêng) với `recovery_target_time`. Cluster chính **không đổi cấu hình, không khởi
động lại** (đổi `archive_mode` bắt buộc restart → CMS/API mất kết nối); slot + DB diễn tập đã xoá sau khi xong (`cleanup`).

| Bước | Thời điểm (UTC) | Số đo |
| --- | --- | --- |
| Base backup toàn cluster (287 MB, 4 DB dev/test) | 06:35:59 → 06:36:12 | **13,0 s** |
| Workload: 1 marker/20 s + 500 đơn/2 phút, 13′ + 4′ | 06:36 → 07:04 | 56 marker, 3.500 đơn, 28 segment WAL (449 MB do seed DB load chạy cùng lúc) |
| Sự cố giả lập: `DELETE drill_markers; DROP TABLE drill_orders` | 07:04:22,9 | marker cuối trước sự cố #56 lúc 07:03:43,9 |
| Lần 1: khôi phục về **now − 10 phút** (06:54:27) | 07:04:27 | **lỗi**: `recovery aborted because of insufficient parameter settings – max_connections = 20 < 100 của primary` → sửa script (bài học #1) |
| Lần 2: khôi phục về **now − 10 phút** (06:54:42) | 07:04:42 → 07:04:46 | chuẩn bị (copy base + WAL) 2,0 s · replay + promote 1,2 s · **RTO kỹ thuật 3,2 s**; 40/40 marker ≤ mốc, `drill_orders` 3.500 dòng, DB dev nguyên vẹn (1.459 user) |
| Khôi phục về **1 s trước sự cố** (đo RPO) | 07:04:56 → 07:05:05 | **RTO 8,6 s**; 56/56 marker (gồm #56 commit 39 s trước sự cố) → **RPO = 0** (không mất giao dịch đã commit) |
| Khôi phục tới **WAL mới nhất** | 07:05:05 → 07:05:33 | 27,6 s; lệnh DROP lúc sự cố có trong archive (bảng không còn) → archive đầy đủ tới thời điểm hỏng |

Kết luận: tiêu chí S11 "khôi phục PITR về 10 phút trước < 60 phút" **ĐẠT trên Postgres cục bộ** (3,2 s kỹ thuật; quy trình người làm
ước tính 15–25 phút gồm quyết định + đổi `DATABASE_URL`). Trên Azure Flexible Server thời gian do Azure quyết định (thường 10–40 phút
cho vài GB, tăng theo lượng WAL replay) – phải diễn tập lại trên staging trước GATE-2 và ghi số đo vào bảng này.

Bài học:
1. Cluster khôi phục phải có `max_connections`, `max_worker_processes`, `max_wal_senders`, `max_prepared_transactions`,
   `max_locks_per_transaction` **≥ primary** (đã gặp thật).
2. Segment cuối của `pg_receivewal` có đuôi `.partial` – khi khôi phục tới "mới nhất" phải đổi tên thành tên segment (script làm tự động).
3. Replication slot không có người đọc giữ WAL vô hạn → đầy đĩa primary. Luôn `pg_drop_replication_slot` khi dừng; alert `DiskUsageHigh`.
4. `pg_basebackup` chụp CẢ cluster (mọi DB) – không khôi phục chọn lọc một DB; muốn lấy lại một bảng: khôi phục vào cluster tạm rồi
   `pg_dump -t` bảng đó sang primary (mục 3.3).

Chạy lại diễn tập (máy dev, quyền root + user `postgres`):

```bash
infra/scripts/pitr-drill.sh start            # slot + pg_receivewal + base backup + workload 13′
infra/scripts/pitr-drill.sh status           # chờ "workload done: yes" (≥ 10′ dữ liệu)
infra/scripts/pitr-drill.sh incident         # sự cố giả lập
infra/scripts/pitr-drill.sh restore          # về now − TARGET_MINUTES_AGO (10) → in RTO + kiểm dữ liệu
RECOVERY_TARGET_TIME='2026-11-02T07:04:21+00' infra/scripts/pitr-drill.sh restore   # mốc tuỳ ý
infra/scripts/pitr-drill.sh restore-latest   # tới WAL mới nhất
infra/scripts/pitr-drill.sh cleanup          # BẮT BUỘC: dừng cluster tạm + pg_receivewal, xoá slot/thư mục/DB drill
```

## 2. Chính sách sao lưu (staging/production)

| Thành phần | Cơ chế | Giữ | Ghi chú |
| --- | --- | --- | --- |
| PostgreSQL Flexible Server | Backup tự động + WAL (PITR) của Azure | **30 ngày** prod/staging (`backup_retention_days`), 7 dev | `geo_redundant_backup` bật ở production (khôi phục khác vùng); Terraform `modules/postgres` |
| Snapshot logic hằng ngày | `pg_dump -Fc` job `dbtools` → bucket `exports/db/` | 30 ngày (lifecycle) | Phòng xoá nhầm server/khác phiên bản; mã hoá ở R2 |
| Redis | Basic/Standard **không** có persistence (C0) → dữ liệu tái tạo được (quota đếm lại từ DB `usage_counters` nightly, cache, BullMQ job id = id nghiệp vụ) | – | Production: Premium/Azure Managed Redis với RDB 60′ (`rdb_backup_enabled`) hoặc AOF; Terraform `modules/redis` biến `persistence` |
| Object storage (R2) | Lifecycle: `recordings` xoá sau 90 ngày (Free)/365 (Pro – theo `expires_at` + job), `exports` 365 ngày | | R2 **không có versioning** đối tượng → bucket `media` sao chép hằng đêm sang bucket `media-backup` (rclone job) – SPEC-ISSUES S127 |

## 3. Quy trình khôi phục (Azure, production)

### 3.1 Quyết định (≤ 10 phút)
1. On-call xác nhận sự cố dữ liệu (xoá nhầm, migration hỏng, hỏng server) – mở kênh sự cố (`docs/runbooks/on-call.md`).
2. Xác định **mốc khôi phục** = trước sự cố 1–2 phút (từ `ops.audit_logs`, log Loki `trace_id`, thời điểm deploy).
3. Bật chế độ bảo trì: kill-switch `ff.billing.checkout=false` (không nhận tiền mới), banner bảo trì web; scale `worker` về 0.

### 3.2 Khôi phục server mới (PITR) (10–40 phút)
```bash
az postgres flexible-server restore \
  --resource-group rg-allingo-prod --name pg-allingo-prod-restore-$(date +%Y%m%d%H%M) \
  --source-server pg-allingo-prod --restore-time "2026-11-02T07:03:00Z"
# Kiểm: số dòng các bảng chính, max(created_at) ops.outbox/learn.attempt_answers ≤ mốc, migration hiện tại (drizzle.__drizzle_migrations)
psql "$RESTORED_URL" -c "select max(created_at) from ops.outbox; select count(*) from billing.orders where status='paid';"
```
4. Tạo lại vai trò `allingo_app` (job `dbtools`) nếu không đi kèm; đổi secret `database-url` trong Key Vault sang server mới
   (versionless → revision mới đọc lại) **hoặc** đổi tên server cũ/mới theo `docs/runbooks/deploy-rollback.md`.
5. Restart revision api/worker; kiểm `GET /v1/health/ready`, dashboard "API SLO", "Thi".

### 3.3 Khôi phục một phần (bảng/khoảng dữ liệu)
Khôi phục PITR sang server tạm → `pg_dump --data-only -t learn.notes --where …` (hoặc `COPY (SELECT …)`) → nạp vào primary trong
transaction, ghi `ops.audit_logs` action `data.restored`. Không ghi đè dòng mới hơn mốc.

### 3.4 Sau khôi phục
- Giao dịch thanh toán trong khoảng [mốc, hiện tại]: chạy `POST /v1/admin/billing/jobs/billing.reconcile` (đối soát với cổng) – IPN
  đến lại do cổng retry; đơn đã trả bị mất sẽ được `payment.reconcile` cấp lại.
- Hàng đợi: job thiếu được tạo lại bởi outbox relay (outbox nằm trong DB đã khôi phục) – kiểm DLQ.
- Ghi vào bảng mục 1 (thời gian thật), báo cáo sự cố (mẫu trong `on-call.md`).
