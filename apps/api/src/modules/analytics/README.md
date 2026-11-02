# analytics (Sprint 10 → Sprint 12)

Ngoại lệ duy nhất được đọc bảng của module khác (CLAUDE.md §5.1) – luôn qua `ReadStoreService`: `DATABASE_URL_REPLICA` nếu có,
không thì cùng DB với `SET TRANSACTION READ ONLY`. Không ghi bảng nghiệp vụ.

| Thành phần | Việc |
| --- | --- |
| `StatsService` + `GET /me/stats` | Dashboard đầy đủ (S10): lịch sử điểm, độ chính xác 30 ngày vs trước (Part/subskill), phút/tuần, từ vựng, sổ lỗi, percentile cộng đồng ẩn danh (≥ 10 người). Phần nặng cache Redis `stats:v1:<user>:<program>` (`STATS_CACHE_TTL_SECONDS`), xoá khi `attempt.graded` / ôn thẻ / sổ lỗi đổi; chuỗi/XP/huy hiệu/lộ trình đọc trực tiếp |
| `WeeklySummaryService` + `AnalyticsJobsService` | Tóm tắt tuần sáng thứ Hai (`WEEKLY_SUMMARY_HOUR_VN`) qua `NotificationService` (`learning.weekly_summary`, dedupe theo tuần), job `notify.weekly_summary` |
| `FunnelService` + `AnalyticsSink` | Phễu server-side từ outbox: signup_done, diagnostic_done, first_attempt, order_paid → PostHog (`POSTHOG_KEY`) – distinct_id = sha256(muối:user_id), không PII; `POST /analytics/events` (client, chỉ khi đồng ý cookie) |
| Hàm thuần `stats-calc.ts` | Cộng breakdown, so sánh hai cửa sổ, percentile mid-rank, nhóm mục tiêu, tuần thứ Hai |

S12: retention, báo cáo beta (`pnpm report:beta`), bảng tổng hợp đêm khi DDL có schema `analytics` (SPEC-ISSUES S113).
