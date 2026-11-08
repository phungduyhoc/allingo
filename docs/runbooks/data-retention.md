# Runbook – Lưu giữ & dọn dữ liệu (`ops.retention_cleanup`, S12)

Job `ops.retention_cleanup` (hàng `maintenance`, mỗi ngày sau `RETENTION_HOUR_VN` = 03:00 giờ VN, khoá Redis theo ngày – một replica)
do module admin điều phối; mỗi module tự xoá bảng của mình (CLAUDE.md §5.1). Kết quả ghi audit `ops.retention_cleanup` (số dòng + chính sách).
Chạy tay: `POST /v1/admin/jobs/dead-letters/...` không áp dụng – dùng `JobsService.dispatch('maintenance', 'ops.retention_cleanup', ...)`
qua script/worker hoặc REPL Nest.

| Dữ liệu | Chính sách | Biến môi trường | Ghi chú |
| --- | --- | --- | --- |
| Ghi âm người học (`learn.recordings` + bucket `recordings`) | quá `expires_at` (Free 90 / Pro 365 ngày – CLAUDE.md §9) | – | xoá tệp S3 rồi xoá hàng; hàng còn được `learn.submissions` tham chiếu → giữ hàng, xoá tệp + transcript, `storage_key = purged/<id>` |
| `ai.ai_tasks` | 180 ngày | `RETENTION_AI_TASKS_DAYS` | báo cáo chi phí AI cũ hơn mất chi tiết – xuất trước nếu cần (Langfuse giữ trace) |
| `ops.outbox` đã relay | 30 ngày | `RETENTION_OUTBOX_DAYS` | chỉ dòng `published_at` không null |
| `ops.notifications` đã xử lý | 180 ngày | `RETENTION_NOTIFICATIONS_DAYS` | sent/read/cancelled/failed; hàng hẹn giờ giữ |
| `ops.audit_logs` | 730 ngày | `RETENTION_AUDIT_DAYS` (≥ 365) | cần pháp chế xác nhận thời hạn lưu (NĐ 13/2023, Luật BVDLCN 2025) – SPEC-ISSUES S133 |
| `ops.jobs_deadletter` đã replay/giải quyết | 90 ngày | `RETENTION_DEADLETTER_DAYS` | |
| Mã mời beta quá hạn | đánh dấu `expired` | – | cũng chạy trong job `beta.invites_send` |

Lô xoá: `RETENTION_BATCH` (1.000) dòng/lượt, tối đa 1.000 lượt/bảng/lần chạy. Bảng partition (ai_tasks, outbox, audit_logs) xoá theo
`created_at` (pruning). Khi khối lượng lớn: chuyển sang DROP partition tháng cũ (migration có cờ `migration-guard: allow`, GĐ2).

Kiểm tra sau khi chạy:
```sql
select created_at, after from ops.audit_logs where action = 'ops.retention_cleanup' order by created_at desc limit 5;
```
Ảnh màn hình góp ý (`catalog.media_assets` origin `learner_upload`) và bài làm Writing theo `iam.deletion_requests` (72 giờ) – không thuộc
job này (xem `data-deletion.md`).
