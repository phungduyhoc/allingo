# Runbook — Redis mất (RedisDown)

Thiết kế degrade có chủ đích (master prompt §7.8): Redis mất → API vẫn ghi bài làm vào DB; mất tạm: quota đếm Redis (bỏ qua, chốt lại từ DB
`usage_counters`), cache (explain/stats/flags – đọc DB), rate limit (fail-open, edge WAF vẫn chặn), thu hồi phiên (fallback DB
`iam.sessions.revoked_at`), BullMQ (job không vào hàng → `JobsService` chạy inline có giới hạn hoặc lỗi 503 với tác vụ dài).

Kiểm chứng S11: alert `RedisDown` (`redis_up == 0` hoặc mất series, `for: 1m`, Alertmanager `group_wait` 15 s cho page) → Slack/Telegram
≤ 2 phút; promtool test `infra/observability/prometheus/tests/alerts.test.yml` (ca 5′ firing, 8′ resolved).

## Xử lý
1. Azure Cache for Redis: trạng thái/bảo trì (`az redis show`), giới hạn kết nối/bộ nhớ (`used_memory`, `evicted_keys` – BullMQ
   cần `noeviction`). Restart/scale: `az redis force-reboot` (mất dữ liệu cache – chấp nhận).
2. Trong lúc mất: kill-switch các tính năng tốn AI nếu chi phí tăng do mất cache (`ff.ai.explain` giữ bật – cache DB vẫn có).
3. Sau khi có lại: worker tự kết nối lại; kiểm DLQ và độ sâu hàng đợi; chạy `POST /v1/admin/billing/jobs/payment.reconcile` nếu webhook
   lỗi trong thời gian mất; quota ngày: job `quota.flush` 00:05 VN chốt lại.
4. Redis mất > 30′ hoặc dữ liệu hỏng: tạo instance mới (Terraform `modules/redis`), đổi secret `redis-url`, restart revision.
