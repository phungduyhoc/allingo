# Sự kiện phân tích & KPI beta (S12)

Nguồn sự thật số liệu beta là **DB (replica, READ ONLY)**; PostHog bổ sung phễu phía client và Web Vitals. Mọi sự kiện **không PII**:
không email/SĐT/tên/IP/nội dung bài làm; `distinct_id` = sha256(muối:user_id) (`ANALYTICS_HASH_SALT`). Client chỉ gửi khi người dùng
đã đồng ý cookie phân tích (`POST /analytics/events` – `consent: true`). Sự kiện server phát từ **outbox** (relay ở worker, một lần/sự
kiện, chống trùng Redis NX) qua `FunnelService` → `AnalyticsSink` (PostHog khi có `POSTHOG_KEY`; test: bộ nhớ; không cấu hình: bỏ).

## 1. Sự kiện

| Sự kiện | Nguồn | Khi | Thuộc tính (không PII) |
| --- | --- | --- | --- |
| `landing_view` | client | xem landing (đã đồng ý cookie) | `path`, UTM |
| `signup_start` | client | mở form đăng ký | `path` |
| `checkout_start` | client | mở checkout | `plan_code`, `path` |
| `signup_done` | outbox `user.registered` | tạo tài khoản | `provider`, `merged_guest`, `referred`, `channel`, `utm_source/medium/campaign` |
| `diagnostic_done` | outbox `attempt.graded` (mode diagnostic) | chấm xong bài chẩn đoán | `program`, `scaled_score` (thang tổng) |
| `first_attempt` | outbox `attempt.graded` | bài chấm đầu tiên của chương trình | `program`, `mode` |
| `order_paid` | outbox `order.paid` | thanh toán thành công | `plan_code`, `amount_vnd`, `provider` |
| `beta_redeemed` (S12) | outbox `beta.redeemed` | đổi mã mời | `program`, `trial` |
| `survey_submitted` (S12) | outbox `survey.submitted` | khảo sát onboarding / NPS | `kind` (beta_onboarding \| nps_d7 \| nps_d14), `score` (NPS), `goal` |
| `feedback_submitted` (S12) | outbox `feedback.submitted` | góp ý in-app | `category`, `has_screenshot` |
| `content_reported` (S12) | outbox `content_report.created` | báo lỗi câu | `reason` |
| `support_ticket_created` (S12) | outbox `support_ticket.created` | tạo ticket | `category` |

Sự kiện miền S12 khác (chỉ trong outbox/audit, không gửi PostHog): `waitlist.joined` {entry_id, program, locale, consent_marketing},
`beta.invited` {invite_id, program, batch}, `content_report.resolved` {report_id, status}, `support_ticket.replied` {ticket_id,
first_response, response_minutes}, `user.locked` / `user.unlocked`.

Metrics Prometheus S12: `beta_waitlist_signups_total{program}`, `beta_invites_total{result=sent|failed|redeemed}`,
`feedback_submitted_total{kind}`, `support_sla_overdue{kind}` (alert `SupportSlaBreached`).

## 2. KPI beta (`pnpm report:beta`, `GET /admin/reports/beta`)

**Nhóm (cohort)** = beta tester: có vai trò `beta_tester` hoặc lời mời `redeemed`; không khách, chưa xoá. **Mốc bắt đầu** =
max(ngày đăng ký, ngày đổi mã) – thời điểm có quyền vào app. Tuần = tuần ISO theo giờ VN (thứ Hai 00:00). SQL: `kpi.sql`.

| KPI | Định nghĩa | Mục tiêu GATE-2 |
| --- | --- | --- |
| Activation | % tester có bài `diagnostic` đã chấm trong ≤ 24 giờ từ mốc bắt đầu; mẫu = tester có mốc ≥ 24 giờ trước thời điểm tính | ≥ 60 % |
| D1 / D7 / D14 | % tester có hoạt động trong **đúng ngày lịch** thứ 1/7/14 (giờ VN) kể từ ngày bắt đầu; mẫu = tester đã qua hết ngày đó | D7 ≥ 35 % |
| Hoạt động | bắt đầu bài làm (`learn.attempts.started_at`), ôn thẻ (`learn.srs_reviews`), gọi giải thích/gia sư AI (`ai_tasks` explain_mcq/tutor_chat) | – |
| Phiên học / tuần | chuỗi hoạt động cách nhau ≤ 30 phút; báo theo tester hoạt động và theo toàn nhóm | – |
| Câu / người | số `attempt_answers` có trả lời trong tuần / số tester | – |
| Giải thích / người | số `ai_tasks` `explain_mcq` trong tuần / số tester | – |
| Tỉ lệ hữu ích (thumbs-up) | `ai.feedback` rating `helpful` / tổng phản hồi của tester trong tuần | ≥ 80 % |
| NPS | %promoter (9–10) − %detractor (0–6) trên mọi trả lời `nps_d7` + `nps_d14` tới hết tuần (tích luỹ) | ≥ 30 |
| Ý định mua | tester đã tạo đơn (thử checkout sandbox) / tổng tester; đơn `paid` (sandbox) | – |
| Chi phí AI / người | tổng `ai_tasks.cost_usd` của tester trong tuần / số tester (×4,3 ≈ tháng) | trong dự toán |
| Crash-free | Sentry Release Health (chưa tích hợp API – báo cáo ghi "chưa có") | ≥ 99,5 % |
| Hỗ trợ | góp ý, báo lỗi câu (mở / quá hạn 48 giờ), ticket (mở / quá hạn 24 giờ, trung vị phản hồi đầu) | 0 lỗi "chặn học" mở > 48 giờ |

## 3. Thống kê câu (job `content.stats_nightly`, 02:00 giờ VN)

Cửa sổ `CONTENT_STATS_WINDOW_DAYS` (365 ngày), chỉ attempt `graded`, câu chấm tự động, attempt có ≥ 2 câu:
- `p_value` = tỉ lệ đúng; `discrimination` = point-biserial (Pearson giữa đúng/sai của câu và tỉ lệ đúng **các câu còn lại** trong
  cùng attempt – `corr()` trong SQL, hàm `pointBiserial` để đối chiếu); `avg_time_ms`; số báo lỗi (mở / xác nhận / tổng).
- Đề xuất (`n ≥ CONTENT_STATS_MIN_N` = 30): `retire` khi phân biệt < 0,1 (âm hoặc rất thấp) hoặc ≥ 5 báo lỗi xác nhận; `review` khi
  quá khó (p < 0,2), quá dễ (p > 0,95), phân biệt 0,1–0,2, hoặc ≥ 3 báo lỗi mở; còn lại `ok`; n nhỏ → `insufficient_data`.
- Lưu `catalog.questions.stats` (JSONB) + `stats_updated_at`; xem `GET /admin/content/questions/stats`.
