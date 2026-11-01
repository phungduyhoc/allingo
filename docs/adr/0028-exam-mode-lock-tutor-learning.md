# ADR-0028: Khoá Exam Mode dùng chung (probe đảo phụ thuộc), gia sư AI ở module learning, guard fail-closed

- **Trạng thái:** Accepted
- **Ngày:** 2026-11-02
- **Nguồn:** Sprint 6 – tutor chat SSE, tra từ, ghi chú, khoá Exam Mode (bổ sung ADR-0002, ADR-0007, CLAUDE.md §5.1/§5.4/§5.8)

## Context
- S6 yêu cầu một cơ chế chung: attempt `mode = exam` đang `in_progress` → `/ai/explain`, `/ai/threads*`, `/dictionary/lookup`, ghi `/notes`
  trả 403 `exam_mode_locked`. Sprint 0–5 dùng cờ Redis `exam:lock:<user>` do test-engine đặt – mất khi Redis khởi động lại, có thể cũ.
- Nguồn sự thật `learn.attempts` thuộc test-engine (tầng 2); ai-gateway/catalog (tầng 1) không được import test-engine (ESLint boundaries).
- Gia sư cần ngữ cảnh: tóm tắt attempt, câu đang xem + trạng thái lộ đáp án, lỗi gần đây (test-engine), mục tiêu (iam), thẻ tóm tắt (learning).
- S5 guard `guard_classify` fail-open có chủ đích; S6 yêu cầu từ chối injection/xin đáp án mà không gọi model chính.

## Decision
1. **`shared/exam/exam-mode.ts`** (`@Global ExamModeModule`): `ExamModeService.registerProbe(fn)` + `ExamModeGuard` + decorator `@ExamLocked()`.
   Test-engine (`AttemptInsightsService.onModuleInit`) đăng ký probe truy vấn `learn.attempts` (index partial `ix_attempts_in_progress`).
   Probe lỗi → cờ Redis; cả hai lỗi → fail-closed. `GuardrailsService.assertNotInExam` uỷ quyền cho dịch vụ này (giữ API cũ).
2. **Gia sư ở `modules/learning/tutor`** (ThreadsService, ContextBuilder thuần, TutorController `/ai/threads*`); ai-gateway giữ `/ai/explain`,
   `/ai/feedback`. Test-engine công khai `AttemptInsightsService` (snapshot attempt không đáp án, `revealState`, `recentMistakes`).
3. **Guard nhiều lớp**: che PII cục bộ → luật cục bộ (EN/VI) → `guard_classify` → fail-closed khi guard lỗi. Từ chối ghi `ai_tasks.status = refused`
   và trả `refusal_code` (web dịch i18n) thay vì chuỗi tiếng Việt cứng.
4. **SSE gia sư** giữ định dạng explain (start/delta/result/done/error) nhưng `delta` là văn bản thuần trích dần từ `reply_markdown`
   (`createJsonFieldStreamer`), `result` là `TutorReply` chuẩn.
5. Tra từ: dịch vụ ở catalog (`DictionaryService`, sở hữu `vocab_items`), controller ở learning (cần `learn.srs_cards` cho `saved`).
   Catalog import ai-gateway qua đường dẫn `core/ai-gateway.service.js` (tránh vòng import với `ai-gateway/index → ai-features → catalog`).

## Consequences
- Mọi endpoint trợ giúp mới chỉ cần `@ExamLocked()`; test ma trận endpoint × trạng thái attempt ở `test/integration/s6-learning-tools.test.ts`.
- Mỗi request bị khoá tốn một truy vấn indexed (≈ < 1 ms); không phụ thuộc Redis để đúng.
- Guard lỗi làm gia sư tạm không dùng được (thà từ chối còn hơn gửi nội dung chưa kiểm tra tới model chính).
- Template `tutor_chat` v1 đặt lịch sử ngoài `<user_input>` → API tự bọc lượt user (SPEC-ISSUES S58), cần prompt v2.
