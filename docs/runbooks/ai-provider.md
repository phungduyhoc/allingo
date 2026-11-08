# Runbook — Sự cố AI provider (Gemini/Claude/OpenAI) & chi phí AI

Alert: `AiFallbackRateHigh` (> 20 %/15′), `AiCircuitOpen`, `AiCostPerHourHigh` (> 5 USD/giờ). Dashboard "AI". Langfuse (trace theo
`ai_task_id`, user băm). AiGateway: retry có jitter (lỗi tạm thời), circuit breaker theo provider (5 lỗi/60 s → mở 60 s), fallback theo
`ai.model_routes`, structured output Zod → repair 1 lần → fallback → `failed` + hoàn credit.

## 1. Provider lỗi / chậm
1. Trang trạng thái nhà cung cấp; `ai_provider_circuit_state` (2 = open) theo provider; lỗi theo task (`ai_task_failures_total`).
2. Fallback đang gánh → chấp nhận tạm (chi phí/chất lượng khác). Nếu cả fallback lỗi: kill-switch theo tính năng
   `PUT /v1/admin/flags/ff.ai.explain {"enabled":false}` / `ff.ai.tutor` → API 503 `feature_disabled`, web ẩn nút (GET /flags, ≤ 30 s).
   Hiệu lực server < 60 s (S11 đo: ngay lập tức; replica khác qua pub/sub < 1 s).
3. Đổi model chính: cập nhật `ai.model_routes` qua admin (không cần deploy), chạy eval trước khi kích hoạt prompt mới.

<a id="chi-phi"></a>
## 2. Chi phí tăng bất thường
1. Dashboard "AI": chi phí theo task × model; `cache_requests_total{cache="explain"}` hit ratio (mục tiêu ≥ 80 %).
2. Người dùng/IP bất thường: `ai.ai_tasks` group by user_id 1 giờ; token bucket `explain`/`tutor` (20/phút/user) + quota ngày Free.
3. Tạm thời: giảm `percent` rollout (`rules.percent`) hoặc tắt cờ; prompt mới dài → rollback `prompt_versions` active.
