-- Migration 0010 (spec v1.1 – B7/S26, ADR-0036): outbox giao theo consumer, thử lại có backoff, dead-letter.
-- Bảng cha partition – ADD COLUMN lan xuống mọi partition con; cột mới có DEFAULT hằng / NULL nên không ghi lại bảng.
--  attempts          số lần giao lỗi (≥ 1 consumer lỗi) – tới OUTBOX_MAX_ATTEMPTS → dead-letter
--  next_attempt_at   chưa tới hạn thì relay bỏ qua (backoff mũ; cũng là "lease" khi một relay đang giao)
--  last_error        tóm tắt lỗi gần nhất "<consumer>: <message>" (không PII – thông điệp lỗi kỹ thuật, cắt 1000 ký tự)
--  pending_consumers consumer còn phải giao (NULL = mọi consumer – lần đầu); consumer đã thành công không chạy lại (idempotent)
--  dead_lettered_at  đã chuyển ops.jobs_deadletter (queue = 'outbox') – relay không nhận nữa cho tới khi admin replay
-- KHÔNG sửa tay sau khi phát hành; thay đổi tiếp theo = migration mới + cập nhật docs/spec/allingo-schema.sql.

ALTER TABLE ops.outbox ADD COLUMN attempts smallint NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE ops.outbox ADD COLUMN next_attempt_at timestamptz;
--> statement-breakpoint
ALTER TABLE ops.outbox ADD COLUMN last_error text;
--> statement-breakpoint
ALTER TABLE ops.outbox ADD COLUMN pending_consumers text[];
--> statement-breakpoint
ALTER TABLE ops.outbox ADD COLUMN dead_lettered_at timestamptz;
