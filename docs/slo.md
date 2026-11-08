# SLO / SLI – Allingo API (Sprint 11)

Nguồn: Thiết kế kỹ thuật v1.0 mục 9, `docs/prompts/ALLINGO-SPRINT-PROMPTS.md` S11. Đo bằng metrics Prometheus do API xuất
(`apps/api/src/shared/telemetry/metrics.ts`, `GET /v1/metrics`), recording rules `infra/observability/prometheus/rules/allingo-recording.yml`,
dashboard "Allingo – API SLO" (`infra/observability/grafana/dashboards/api-slo.json`). Cửa sổ đánh giá: **30 ngày lăn**.

## 1. SLO

| # | SLO | SLI (PromQL) | Mục tiêu | Alert |
| --- | --- | --- | --- | --- |
| 1 | Availability API | `1 − 5xx / tổng` request, trừ `/v1/health*`, `/v1/metrics` (`allingo:http_error_ratio:*`) | **≥ 99,9 %** (budget 43 phút/30 ngày) | `ApiHighErrorRate` (> 1 %/5′), `ErrorBudgetFastBurn` (14,4×, 1 h + 5′) |
| 2 | Độ trễ đọc | p95 `http_server_request_duration_seconds{method="GET"}` (`allingo:read_latency_p95:5m`) | **< 300 ms** | dashboard; ticket khi > 300 ms 30′ |
| 3 | Lưu nháp khi thi | p95 `PUT /v1/attempts/:attemptId/answers` (`allingo:draft_save_latency_p95:10m`) | **< 200 ms** | `DraftSaveLatencyHigh` (> 500 ms/10′ – page) |
| 4 | Nộp bài | p95 `POST /v1/attempts/:attemptId/submit` | < 800 ms | dashboard "Thi" |
| 5 | Xem lại | p95 `GET /v1/attempts/:attemptId/review` | < 400 ms | dashboard "Thi" |
| 6 | Giải thích (trúng cache) | p95 `POST /v1/ai/explain` khi `ai_task_duration_seconds{model="cache"}` | **< 500 ms** | dashboard "AI" |
| 7 | Chấm Writing (GĐ2) | thời gian `grade.writing` từ submit tới `submission.graded` (`bullmq_job_duration_seconds{job="grade.writing"}` + chờ) | < 60 s p95 | `QueueBacklog` |
| 8 | Hàng đợi | không job trong dead-letter; job chờ lâu nhất < 10′ | 0 DLQ | `DeadLetterJobs`, `QueueBacklog` |

Ghi chú đo: nhãn `route` là mẫu đường dẫn Fastify (không id) – cardinality thấp; histogram có mốc 0,2 / 0,3 / 0,4 / 0,5 / 0,8 s đúng ngưỡng SLO.
Số đo nền (máy phiên, S11): xem báo cáo hiệu năng S11 trong `docs/perf/` – p95 lưu nháp 50 ms, review 49 ms, explain cache 42 ms ở ~1.500 VU thời gian thực.

## 2. Error budget

- Budget/tháng = 0,1 % request (≈ 43 phút downtime toàn phần). Tiêu hao = 5xx + request vượt SLO độ trễ của nhóm "lưu nháp" (tính riêng,
  budget độ trễ = 1 % request lưu nháp > 200 ms).
- Burn rate cảnh báo (Google SRE workbook): 14,4× trong 1 giờ **và** 5 phút → page; 6× trong 6 giờ → ticket.

## 3. Chính sách đóng băng tính năng

| Budget còn lại (30 ngày) | Hành động |
| --- | --- |
| > 50 % | Deploy bình thường (canary 10 % → 100 %). |
| 25–50 % | Mỗi deploy cần người duyệt thứ hai + theo dõi 30′; ưu tiên việc ổn định trong sprint. |
| < 25 % | **Đóng băng tính năng**: chỉ hotfix/sửa độ tin cậy; postmortem cho mọi sự cố tiêu > 10 % budget. |
| Hết budget | Đóng băng tới khi budget hồi > 25 %; không deploy trong 19:00–23:00 (giờ học/thi cao điểm) trừ SEV-1. |

Ngoại lệ do sự cố bên thứ ba (AI provider, cổng thanh toán) vẫn tính vào budget nhưng không kích hoạt đóng băng nếu đã có kill-switch/fallback
hoạt động đúng (ghi trong postmortem).

## 4. Giới hạn tốc độ (bảo vệ SLO)

| Lớp | Giới hạn | Khoá |
| --- | --- | --- |
| Edge Cloudflare | `/v1/auth/*` 20 req/10 s/IP (Free); Pro+: OTP, webhook (`extra_rate_limits`), allowlist IP webhook | IP |
| API toàn cục | `RATE_LIMIT_MAX` (300)/phút/IP, store Redis, IP trong `RATE_LIMIT_ALLOWLIST` bỏ qua | IP |
| Token bucket (Redis Lua) | explain 20/phút, tutor 20/phút, submit 10/phút, orders 10/10′, pay 10/10′, uploads 30/10′ (theo user); login 100/5′, otp 30/15′, register 60/giờ, webhook 120/phút (theo IP – rộng cho lớp học sau NAT) | user / IP |
| Đăng nhập | 10 lần sai/15′ theo email → khoá 15′ (cả email không tồn tại) | email băm |
| OTP | 3 yêu cầu/15′, 5 lần sai khoá 30′ (S1) | định danh |

Phản hồi vượt: 429 `rate_limited` + `Retry-After` + `details.retry_after_sec` (+ `bucket` | `scope` | `reason`), header
`X-RateLimit-Limit` / `X-RateLimit-Remaining`. Hệ số `RATE_LIMIT_BUCKET_MULTIPLIER` chỉnh toàn bộ bucket (load test, sự kiện lớn).
