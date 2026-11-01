# ADR-0027: `JobsService` – job nền đăng ký theo module, BullMQ ở prod, chế độ inline cho dev

- **Trạng thái:** Accepted
- **Ngày:** 2026-11-01
- **Nguồn:** Sprint 5 – content.generate, summary.attempt, eval.run (bổ sung ADR-0006, CLAUDE.md §5.5)

## Context
- S5 thêm ba job dài (> 2 s): `content.generate` (sinh + kiểm tra + dedup), `summary.attempt` (summarize_attempt sau mỗi 3 bài), `eval.run`.
- `WorkerRunner` cũ gom handler bằng tay; module nghiệp vụ (catalog, learning, ai-gateway) không có chỗ đăng ký.
- Phiên dev/cloud chỉ chạy `apps/api` (không chạy `src/worker.ts`) → job vào BullMQ sẽ không bao giờ chạy.

## Decision
1. `JobsService` (shared, global): module gọi `register(queue, name, handler)` ở `onModuleInit`; `dispatch(queue, name, businessId, payload)`
   đưa vào BullMQ với `jobId = <name>__<businessId>` (idempotent – S27) và `attempts: 2`; worker lấy `handlersFor(queue)`.
2. `JOBS_INLINE=true` (hoặc Redis không sẵn sàng / enqueue lỗi) → chạy handler trong process API ngay sau khi trả 202, chống trùng
   trong process theo jobId. Mặc định `false`; chỉ bật ở dev/test (đặt trong `.env` cục bộ của phiên cloud – A59).
3. Trạng thái job (polling) lưu Redis `jobstatus:<job>:<id>` 7 ngày (dự phòng bộ nhớ khi Redis mất): queued → running → completed | failed,
   kèm `progress`, `result`, `error`. Endpoint đọc: `GET /admin/generate/questions/{jobId}`, CMS `/internal/content/questions/generate/{jobId}`.

## Consequences
- Inline chạy cùng event loop API: chỉ dùng dev/test; prod luôn qua worker.
- Kết quả job chỉ giữ 7 ngày trong Redis; dữ liệu bền nằm ở bảng nghiệp vụ (draft catalog, learn.notes, ai.eval_runs).
