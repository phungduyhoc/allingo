# ADR-0032: PlanGenerator thuần trong gói `@allingo/planner`; AI chỉ đề xuất điều chỉnh (plan_adjust), server quyết định

- **Trạng thái:** Accepted
- **Ngày:** 2026-11-02
- **Nguồn:** Sprint 9 – Lộ trình tuần, check-in & điều chỉnh (thiết kế kỹ thuật §6.4; CLAUDE.md §5.2–5.3)

## Context
- Lộ trình phải tuân thủ cứng: không vượt phút/tuần người học chọn, đúng ngày học, task trỏ nội dung có thật, tuần cuối mô phỏng,
  full test theo gói (Pro 2 tuần / Free 1 tháng). LLM sinh lịch trực tiếp không bảo đảm được các ràng buộc này và khó kiểm thử.
- Cùng thuật toán cần dùng ở API (sinh/sinh lại), worker (job), test property-based và có thể ở web (xem trước) – không phụ thuộc DB.

## Decision
1. Gói mới **`packages/planner`** (TS thuần, không I/O, không phụ thuộc runtime): `generatePlan` / `validatePlan` / `applyAdjustOps`
   / tiến độ (`dayStatuses`, `weekProgress`, `forecastStatus`, `examProgress`, `quickSuggestion`) / tiện ích ngày theo múi giờ.
2. **Thuật toán v1**: tuần 7 ngày NEO VÀO NGÀY THI (tuần cuối = 7 ngày trước ngày thi; không có ngày thi → 8 tuần từ hôm nay); chu
   kỳ 3 tuần nền → luyện → mô phỏng, tuần cuối luôn mô phỏng; ngân sách tuần = phút/tuần × tỉ lệ ngày học trong tuần; việc bắt buộc:
   ôn từ vựng mỗi ngày học, điểm danh ngày học cuối tuần, full test đếm ngược từ tuần cuối theo nhịp gói; phần còn lại chia lượt
   luyện 10 câu theo Part bằng trọng số (sàn 0,15 + 1 − mastery trung bình) giảm dần kiểu D'Hondt, Part trọng tâm ×1,5; tuần nền thêm
   bài học/ngữ pháp. Mọi task trỏ `test_set | section | lesson | vocab_list` lấy từ catalog (`CatalogQueryService.planContent`).
3. **Property-based test** (`fast-check`, 500 ca × 5 thuộc tính) là điều kiện phát hành của generator; API chạy `validatePlan` trước
   khi lưu (vi phạm → lỗi nội bộ, không lưu).
4. **Điều chỉnh**: AI `plan_adjust` (qua AiGateway, prompt registry, Zod) chỉ trả **ops** (move/swap/skip/reduce/reschedule_rest/
   set_daily_window/reduce_load_week/none); server `applyAdjustOps` áp dụng thử + kiểm tra (không sửa task đã xong/quá khứ, chỉ tuần
   được phép – check-in: tuần tới, không vượt ngân sách & thời gian rảnh khai báo, ≤ 1 full test/tuần, nội dung có thật) → đề xuất
   `ready | rejected` lưu `learn.plan_adjustments` (migration 0006); `apply` kiểm lại trên dữ liệu mới nhất trong một transaction.
5. Cài đặt lộ trình (phút/tuần, ngày học, giờ nhắc, múi giờ, ngày bắt đầu) nằm trong `learn.study_plans.strategy.settings`
   (JSONB sẵn có) cùng `weeks_meta` (ngày kết thúc, ngân sách, pha) – không thêm cột.

## Consequences
- Lộ trình xác định và kiểm thử được; nâng cấp v2 (mastery path, AI) thay generator mà giữ hợp đồng DTO.
- Đề xuất AI có thể bị từ chối nhiều nếu model trả ops sai – đo tỉ lệ `rejected` qua `learn.plan_adjustments` + eval `plan_adjust_v1`.
- Turborepo tự nhận gói qua workspace; API/worker phụ thuộc `@allingo/planner` (build trước `apps/api`).
