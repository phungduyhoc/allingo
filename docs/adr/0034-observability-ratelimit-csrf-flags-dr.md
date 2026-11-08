# ADR-0034: Quan sát as code, rate limit Redis, CSRF theo Origin, feature flag có invalidation, sao lưu/khôi phục

- **Trạng thái:** Accepted
- **Ngày:** 2026-11-08
- **Nguồn:** Sprint 11 – Hiệu năng, bảo mật, vận hành (CLAUDE.md §5.5, §5.7, §8, §9; Thiết kế kỹ thuật §9)

## Context
- Trước S11: metrics chỉ có AI (ADR-0026); trace_id có thể lấy từ `x-request-id` bất kỳ; rate limit `@fastify/rate-limit` lưu bộ
  nhớ process (mỗi replica riêng); không kiểm CSRF dù có cookie-auth và parser form toàn cục; feature flag đọc DB mỗi lần, không có
  API quản lý/công khai; không có dashboard/alert as code, không diễn tập khôi phục.
- Load test S11 (2.000 user/20.000 attempt/2 triệu answer) làm treo API: deadlock pool (truy vấn ngoài transaction khi đang giữ
  transaction), N+1 ở review/sổ lỗi, quét toàn bộ partition `learn.attempt_answers`.

## Decision
1. **Telemetry**: `AsyncLocalStorage` request context (`trace_id` 32 hex từ span OTel → `traceparent` → `x-request-id` an toàn →
   ngẫu nhiên), trả `x-trace-id` + trong envelope lỗi; pino `mixin` gắn trace_id, `formatters.log` + `hooks.logMethod` redact sâu theo
   khoá và theo giá trị (email/điện thoại VN/JWT/Bearer/query bí mật). Registry Prometheus tự viết (ADR-0026) mở rộng: RED theo route
   mẫu Fastify, DB (pool, truy vấn chậm > `DB_SLOW_QUERY_MS` qua wrapper postgres-js), BullMQ (độ sâu/chờ/thất bại/DLQ, collector bất
   đồng bộ), cache, billing, partition. Job BullMQ mang `_traceparent`. Worker có endpoint metrics riêng.
2. **Sentry không SDK**: `SentryReporter` gửi Envelope HTTP, chỉ lỗi ngoài `AppError`/5xx, đã redact; transport tiêm được để test.
3. **Stack quan sát as code** `infra/observability/` (Prometheus, Alertmanager, Grafana, Loki, Tempo, OTel Collector, exporters):
   recording rules + 18 alert có `runbook_url` (promtool test), 6 dashboard sinh từ `grafana/dashboards.py`; production dùng Azure
   Monitor/App Insights (module Terraform `observability/alerts.tf`) + Grafana Cloud/self-host tuỳ chi phí.
4. **Rate limit hai lớp**: toàn cục theo IP (store Redis, allowlist env, envelope chuẩn) + token bucket Lua trên Redis theo route
   (`@RateLimit(bucket)` + `RateLimitGuard`, khoá user hoặc IP, thời gian Redis TIME); fail-open khi Redis lỗi. Khoá đăng nhập theo
   email + thời gian phản hồi tối thiểu cho luồng auth.
5. **CSRF theo Origin** (không token): cookie-auth hoặc mọi POST `/v1/auth/*` phải có `Origin`/`Sec-Fetch-Site`/`Referer` thuộc
   danh sách tin cậy; SameSite=Lax giữ nguyên; header bảo mật (HSTS, CSP JSON `default-src 'none'`, `no-store` khi có phiên).
6. **Feature flag**: `FeatureFlagsService` cache process 5 s → Redis TTL → DB, `PUT` xoá Redis + pub/sub tới replica (hiệu lực < 60 s,
   thường < 1 s); `GET /admin/flags*`, `GET /flags` công khai (allowlist khoá); `@KillSwitch(flag)` + guard sau Auth, trước RateLimit
   → 503 `feature_disabled` + `Retry-After`.
7. **Hiệu năng**: không truy vấn ngoài transaction trong khi giữ transaction (đọc trước); batch (MGET + 1 SELECT, INSERT nhiều dòng,
   UPDATE … FROM VALUES); điều kiện `created_at >= started_at` để cắt tỉa partition; cache phiên bản câu hỏi 30 s; backpressure tạm dừng
   `notify`/`analytics` khi `grading` dồn.
8. **Migration an toàn**: `db/src/migration-guard.ts` chặn thao tác phá huỷ/khoá bảng (drop, rename, đổi kiểu, NOT NULL không default,
   index không CONCURRENTLY…) trừ khi có đánh dấu lý do; migration `-- concurrent-safe` chạy `CREATE INDEX CONCURRENTLY` trước drizzle.
9. **DR**: Azure PG PITR 30 ngày (geo-redundant ở prod), diễn tập bằng `infra/scripts/pitr-drill.sh`; Redis coi là tái tạo được
   (RDB ở Premium); R2 không versioning → sao chép hằng đêm sang bucket backup (S127).

## Consequences
- (+) Một `trace_id` xuyên web → API → job → log/trace; alert có runbook; kill-switch không cần deploy; load test máy phiên từ treo →
  p95 lưu nháp 50 ms, 0 lỗi.
- (+) Không thêm dependency npm runtime.
- (−) Bucket rate limit, khoá đăng nhập, ngưỡng backpressure là số giả định (A176–A188) – phải hiệu chỉnh theo dữ liệu thật.
- (−) CSRF theo Origin phụ thuộc trình duyệt gửi Origin/Sec-Fetch-Site (mọi trình duyệt hiện hành); client không phải trình duyệt
  không có cookie nên không bị ảnh hưởng.
- (−) Stack quan sát chưa chạy được bằng Docker trong phiên (chỉ promtool/amtool/Prometheus nhị phân) – cần dựng trên staging.
