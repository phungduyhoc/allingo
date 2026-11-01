# grading (Sprint 7–8 GĐ2)
Pipeline chấm Writing/Speaking: `submissions` → job BullMQ `grade.writing|grade.speaking` → AiGateway (`grade_writing_*`, `grade_speaking_*`) → `grading_results` + `phrasing_fixes`; hoàn credit khi lỗi; redo. Phụ thuộc: ai-gateway, speech, billing, catalog.

Sprint 2 – `POST /v1/uploads/presign` (`uploads.controller.ts`): recording → `learn.recordings` (bucket `recordings`, `expires_at` 90/365 ngày theo gói), image → `catalog.media_assets` `uploading` (bucket `recordings`, qua `MediaAssetsService` của speech). URL PUT ký `Content-Type` + `Content-Length`, hạn 10 phút; client phải gửi đúng `Content-Type` đã khai báo.
