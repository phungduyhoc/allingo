-- Migration 0012 (spec v1.1 – C1): khu học đa chương trình.
-- iam.users.active_program: chương trình đang học do người học chọn (bộ chọn chương trình ở header/onboarding, PATCH /me).
-- NULL (người dùng cũ) → API dùng enrollment active cập nhật gần nhất như trước (tương thích ngược, không cần backfill).
-- Mục tiêu điểm/ngày thi/lộ trình vẫn tách theo chương trình trong learn.enrollments (UNIQUE user_id, program_code).
-- KHÔNG sửa tay sau khi phát hành; thay đổi tiếp theo = migration mới + cập nhật docs/spec/allingo-schema.sql.

ALTER TABLE iam.users ADD COLUMN active_program text;
--> statement-breakpoint
ALTER TABLE iam.users ADD CONSTRAINT fk_users_active_program FOREIGN KEY (active_program) REFERENCES catalog.programs(code);
