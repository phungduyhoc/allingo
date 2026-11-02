# ADR-0033: FSRS-5 + sổ lỗi theo luật ở learning; analytics đọc kho đọc + cache; phễu server-side; marketing trong Payload

- **Trạng thái:** Accepted
- **Ngày:** 2026-11-02
- **Nguồn:** Sprint 10 – FSRS từ vựng, sổ lỗi, thống kê & dashboard, marketing & blog (CLAUDE.md §5.1, §5.7, §5.8, §5.12)

## Context
- Ôn tập phải đúng lịch FSRS, test được bằng đồng hồ giả, tối ưu tham số theo người dùng sau ≥ 1.000 review; hạn mức "thẻ mới/ngày"
  Free 10 / Pro 30 lấy từ `billing.quotas` (không hard-code). ts-fsrs 6.0.0 không kèm optimizer.
- Sổ lỗi dựng từ `attempt.graded` (local + outbox relay), gộp theo câu, phân loại bằng luật (AI gán nhãn tinh ở GĐ2).
- `GET /me/stats` gộp nhiều bảng của nhiều module (attempts, srs, sổ lỗi, enrollments) – CLAUDE.md cho phép **analytics đọc replica**;
  DDL chưa có schema `analytics` (bảng tổng hợp đêm). p95 < 300 ms với 50 attempt/người.
- Web marketing cần nội dung song ngữ biên tập được, chỉ lộ bản đã xuất bản, làm mới ISR ngay khi xuất bản.

## Decision
1. **`@allingo/fsrs`**: FSRS-5 (19 trọng số mặc định), retention 0,9, ≤ 365 ngày, không fuzz, bước học `1m` / học lại `10m` (Again →
   trong phiên, Good → ≥ ngày mai). Một bước ⇒ `learning_steps` luôn 0 → dựng lại trạng thái chỉ từ cột DDL (`fromStored`), không thêm
   cột. Bộ tối ưu nhẹ (coordinate descent trên log-loss R(t,S), kẹp biên FSRS-5, chấp nhận khi giảm ≥ 1 %) – thay bằng binding chính
   thức khi có. Trọng số lưu `learn.enrollments.fsrs_params` (migration 0007), job `srs.optimize` Chủ nhật 03:00 VN.
2. **Quota thẻ mới áp khi HỌC** (lần ôn đầu của thẻ `new`, `FeatureGateService.consume(srs_new_cards, amount)` – cả lô 429 nếu vượt),
   không khi thêm thẻ/thêm cả bộ. `GET /me/srs/due` = đến hạn (learning trước) + thẻ mới ≤ phần còn lại của hạn mức.
   `POST /me/srs/review` idempotent theo UNIQUE `(card_id, reviewed_at)`.
3. **Sổ lỗi** (`ErrorLogService`, learning): `AttemptsService.wrongAnswersOf` (test-engine sở hữu bảng attempts) → `classifyError`
   (timeout theo ngưỡng Part → subskill → topic → Part) → `INSERT … ON CONFLICT (user_id, question_id) DO UPDATE … WHERE attempt_id IS
   DISTINCT FROM excluded.attempt_id` (idempotent local + relay; sai lại → mở lại, `occurrences + 1`). Section lưu trong
   `reason_auto.evidence.section` để learning không truy vấn bảng catalog. Drill "làm lại câu sai" = `AttemptsService.createFromQuestions`
   (đúng các câu, bản phát hành hiện hành, timed_drill, quota part_drill). Đọc/sửa sổ lỗi `@ExamLocked`; thẻ kind `error` bị loại khỏi
   phiên ôn khi đang thi.
4. **Analytics** (tầng 4): `ReadStoreService` = `DATABASE_URL_REPLICA` hoặc cùng DB, luôn `SET TRANSACTION READ ONLY`. `StatsService`
   tính phần nặng bằng SQL trên kho đọc, cache Redis `stats:v1:<user>:<program>` (`STATS_CACHE_TTL_SECONDS`, 1 giờ), xoá khi
   `attempt.graded` (local + outbox), `srs.reviewed`, `error_log.updated/resolved`; phần nhẹ (chuỗi, XP, huy hiệu, lộ trình) luôn đọc
   trực tiếp. Percentile cộng đồng: nhóm (chương trình, mức mục tiêu), ≥ 10 người, mẫu điểm cache 1 giờ. Chưa có bảng tổng hợp đêm
   (đề xuất ở SPEC-ISSUES S113). Dự báo v0 (`forecastLinear`) ở learning, lưu `learn.score_forecasts` ≤ 1 lần/ngày.
5. **Phễu server-side**: `AnalyticsSink` (PostHog HTTP `/i/v0/e/` | memory | none) nghe **outbox** (`user.registered`,
   `attempt.graded`, `order.paid`) → signup_done / diagnostic_done / first_attempt / order_paid; distinct_id = sha256(muối:user_id)[0:32],
   uuid sự kiện xác định + Redis NX chống trùng; khách bỏ qua. `POST /analytics/events` chỉ nhận khi `consent = true`.
   Attribution lần chạm đầu → `iam.users.attribution` (host referrer, path không query, UTM lọc email/số điện thoại).
6. **Marketing trong Payload** (schema `cms`): `pages` (blocks hero/features/pricing/faq/testimonial/cta), `posts`, `redirects`,
   `categories`, `authors`, `marketing-media` (đọc công khai); văn bản group `{vi, en}` (không bật localization toàn cục – giữ quy ước
   JSONB {vi,en} và không ảnh hưởng collection cũ); `versions.drafts`, access đọc công khai `_status = published`; JSON-LD tính ở
   `afterRead`; `afterChange/afterDelete` gửi webhook revalidate ký HMAC (`x-allingo-signature = sha256=HMAC(secret, "<ts>.<body>")`).

## Consequences
- Lịch ôn xác định, khớp ts-fsrs từng bước (test mô phỏng 7 ngày); đổi sang nhiều bước học cần cột `learning_steps`.
- `GET /me/stats` p95 vài ms khi cache; khi không cache ~ 100 ms với 50 attempt – bảng tổng hợp đêm cần khi dữ liệu lớn.
- Phễu không phụ thuộc trình duyệt cho sự kiện quan trọng; sự kiện client chỉ khi có đồng ý cookie (web phụ trách banner).
- Web cần route `/api/revalidate` kiểm chữ ký (±5 phút) và đọc REST `/api/pages|posts|redirects` của CMS.
