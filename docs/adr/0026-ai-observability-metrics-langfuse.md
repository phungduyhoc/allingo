# ADR-0026: Quan sát AI Gateway – Prometheus `/v1/metrics` tự viết, span `ai.task`, Langfuse qua HTTP ingestion

- **Trạng thái:** Accepted
- **Ngày:** 2026-11-01
- **Nguồn:** Sprint 5 – AI Gateway mức sản xuất (bổ sung ADR-0007, ADR-0015)

## Context
- S5 yêu cầu metrics `ai_task_duration_seconds`, `ai_task_cost_usd_total`, `ai_task_failures_total{task,model}`, span OTel `ai.task` và
  Langfuse (user_id băm, không nội dung khi `AI_TRACE_CONTENT=false`), dashboard chi phí khớp Langfuse ±1 %.
- Repo chưa có `prom-client` hay SDK Langfuse; phiên phát triển không có khoá Langfuse; không muốn thêm phụ thuộc chỉ để xuất vài chuỗi văn bản.

## Decision
1. **Registry Prometheus tối giản** (`apps/api/src/shared/telemetry/metrics.ts`): Counter/Gauge/Histogram, text exposition 0.0.4.
   Endpoint `GET /v1/metrics` (ngoài OpenAPI như `/health`) bảo vệ bằng `Authorization: Bearer <METRICS_TOKEN>` (trống → `INTERNAL_API_TOKEN`)
   hoặc `X-Internal-Token`; ingress chỉ mở cho mạng nội bộ/Prometheus. Nhãn chỉ gồm task/model/provider/status – không user, không nội dung.
   Metrics: `ai_task_duration_seconds{task,model,status}`, `ai_task_cost_usd_total{task,model}`, `ai_task_failures_total{task,model}`,
   `ai_task_tokens_total{task,model,direction}`, `ai_task_cache_hits_total{task}`, `ai_task_fallbacks_total{task,model}`,
   `ai_provider_circuit_state{provider}` (0 closed · 1 half_open · 2 open), `ai_provider_retries_total{provider}`.
2. **OpenTelemetry**: span `ai.task` (tracer `allingo.ai-gateway`) mở khi tạo `ai_tasks`, đóng khi kết thúc; thuộc tính
   `ai.task_code`, `ai.prompt_version_id`, `ai.model`, `ai.provider`, `ai.tokens_in/out`, `ai.cost_usd`, `ai.cache_hit`, `ai.fallback_used`,
   `ai.status`, `ai.error_code`. SDK OTel chỉ khởi động khi `OTEL_ENABLED=true` (không bật → API no-op).
3. **Langfuse** qua `POST {LANGFUSE_BASE_URL}/api/public/ingestion` (Basic `public:secret`), gửi theo lô (≤ 40 sự kiện hoặc mỗi
   `LANGFUSE_FLUSH_INTERVAL_MS`), không chặn request, lỗi chỉ log. `trace-create` + `generation-create` (id = `ai_task_id`);
   `userId` = `u_` + HMAC-SHA256(AUTH_SECRET, user_id)[0..24]; `usage.totalCost` = đúng `ai_tasks.cost_usd` (cùng nguồn với
   `GET /admin/reports/ai-costs` → khớp tuyệt đối). `input/output` chỉ khi `AI_TRACE_CONTENT=true`.
4. **Chi phí**: tính ở AiGateway từ token × bảng giá `ai.model_routes.params.pricing[alias]` (seed từ `DEFAULT_MODEL_PRICING` trong
   `@allingo/schemas`) – adapter không giữ bảng giá.

## Alternatives considered
- `prom-client` + `langfuse` SDK: thêm 2 phụ thuộc và API lớn hơn nhu cầu; có thể thay sau nếu cần exemplar/default metrics.
- OTel metrics exporter: chưa có collector nhận metrics trong hạ tầng S5; Prometheus scrape đơn giản hơn.

## Consequences
- Metrics theo process: worker (không HTTP) không được scrape – job AI chạy trong worker chỉ hiện ở Langfuse/`ai_tasks`;
  cần Pushgateway hoặc cổng metrics cho worker trước GĐ1 (SPEC-ISSUES S44).
- Nhiều replica API: Prometheus cộng theo `instance` – không cần đồng bộ trạng thái.
- Breaker theo process (không chia sẻ giữa replica) – chấp nhận ở GĐ0/GĐ1.
