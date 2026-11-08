# Runbook — DB chậm / kết nối cạn / đĩa đầy / partition

Alert liên quan: `DraftSaveLatencyHigh`, `DbConnectionsHigh`, `DiskUsageHigh`, `PartitionMissing`, `EventLoopLagHigh`. Dashboard
"Hạ tầng", "Thi". Số đo nền: `docs/perf/report-S11.md`.

## 1. Chẩn đoán nhanh (5 phút)
1. Dashboard "Hạ tầng": p95 truy vấn theo bảng, `db_slow_queries_total` theo bảng (ngưỡng `DB_SLOW_QUERY_MS` = 200 ms). Log:
   `{service="allingo-api"} | json | msg="slow query"` – có `sql` tham số hoá (không giá trị) + `trace_id`.
   Lưu ý (S11): thời gian đo ở app **gồm thời gian chờ kết nối pool** – slow query trên MỌI bảng cùng lúc ⇒ pool cạn, không phải SQL chậm.
2. Trên DB:
```sql
select pid, state, wait_event_type, wait_event, now() - query_start as dur, left(query, 120)
from pg_stat_activity where datname = current_database() and state <> 'idle' order by dur desc limit 20;
select state, count(*) from pg_stat_activity group by 1;               -- "idle in transaction" nhiều = app giữ transaction
select relname, seq_scan, seq_tup_read, idx_scan from pg_stat_user_tables order by seq_tup_read desc limit 10;
```
3. Truy vấn nghi vấn: `EXPLAIN (ANALYZE, BUFFERS)` trên bản sao/staging (không chạy ANALYZE câu ghi trên production).

<a id="ket-noi"></a>
## 2. Kết nối cạn (DbConnectionsHigh)
- Tổng = `DB_POOL_MAX` × số replica api + worker + CMS. B1ms: 50 kết nối; D2ds: ~859. Giảm `DB_POOL_MAX` hoặc bật **PgBouncer**
  (Azure Flexible có PgBouncer tích hợp cổng 6432 – `pgbouncer.enabled=true`; postgres-js `prepare: false` khi qua transaction pooling).
- Nhiều `idle in transaction` + API treo: dấu hiệu **deadlock pool** (transaction giữ kết nối rồi gọi truy vấn ngoài transaction cần kết nối
  thứ hai). S11 đã sửa ở gamification/sổ lỗi; nếu tái diễn: tìm `this.dbs.db` dùng bên trong `transaction(async (tx) => …)`.
  Tạm thời: tăng `DB_POOL_MAX` + restart revision.

<a id="api-cpu"></a>
## 3. API CPU/event loop (EventLoopLagHigh)
Node đơn luồng: ~120 req/s/replica 1 vCPU ở p95 < 200 ms (report-S11). Scale out (`min_replicas`), kiểm Review đề 200 câu (JSON ~250 KB),
`CATALOG_CACHE_TTL_SECONDS` > 0.

## 4. Truy vấn chậm cụ thể
- Thiếu index → migration mới `CREATE INDEX IF NOT EXISTS … -- concurrent-safe` (migrate.ts tạo CONCURRENTLY). Không tạo index tay
  trên production ngoài migration (db:diff sẽ lệch).
- `learn.attempt_answers`: luôn kèm `created_at >= attempts.started_at` để **partition pruning** (S11).

<a id="dia-day"></a>
## 5. Đĩa đầy (DiskUsageHigh)
WAL tăng do replication slot treo (`select slot_name, active, pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) from pg_replication_slots;`
→ `pg_drop_replication_slot`), bloat (autovacuum), log. Azure: bật storage auto-grow (Terraform `auto_grow_enabled`).

<a id="partition"></a>
## 6. Thiếu partition (PartitionMissing)
Job `ops.partition.ensure` (worker, hằng đêm 00:05 VN + khi khởi động) tạo tháng hiện tại + 2 tháng tới cho `learn.attempt_answers`,
`ai.ai_tasks`, `ops.audit_logs`, `ops.outbox`. Thiếu → INSERT tháng mới lỗi. Chạy tay ngay:
`DATABASE_URL_MIGRATE=… pnpm --filter @allingo/db exec tsx scripts/ensure-partitions.ts` rồi kiểm `db_partition_months_ahead ≥ 2`.
