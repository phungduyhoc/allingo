-- Migration 0007 (spec v1.1 – Sprint 10): FSRS + sổ lỗi + attribution.
-- 1) learn.srs_reviews: UNIQUE (card_id, reviewed_at) – POST /me/srs/review idempotent theo (thẻ, thời điểm ôn) kể cả khi
--    request song song (SPEC-ISSUES S107).
-- 2) learn.enrollments.fsrs_params: trọng số FSRS-5 tối ưu theo người dùng × chương trình (job srs.optimize hằng tuần sau
--    ≥ 1.000 review) {model, w[19], review_count, loss_default, loss_optimized, optimized_at} – DDL không có
--    study_plans.fsrs_params (lộ trình đổi phiên bản khi sinh lại) (S108).
-- 3) learn.error_log_entries: phiên bản câu đã làm (CLAUDE.md §5.9), attempt gần nhất, số lần sai (gộp trùng câu), lần sai
--    gần nhất, ghi chú người học, updated_at; UNIQUE (user, question) cho câu trắc nghiệm (gộp), index lỗi chưa hiểu (S109).
-- 4) iam.users.attribution: UTM/referrer lần chạm đầu khi đăng ký (S110).
-- KHÔNG sửa tay sau khi phát hành; thay đổi tiếp theo = migration mới + cập nhật docs/spec/allingo-schema.sql.

CREATE UNIQUE INDEX ux_srs_reviews_card_time ON learn.srs_reviews(card_id, reviewed_at);
--> statement-breakpoint
ALTER TABLE learn.enrollments ADD COLUMN fsrs_params jsonb;
--> statement-breakpoint
ALTER TABLE learn.error_log_entries
  ADD COLUMN question_version_id uuid REFERENCES catalog.question_versions(id),
  ADD COLUMN attempt_id          uuid REFERENCES learn.attempts(id) ON DELETE SET NULL,
  ADD COLUMN occurrences         integer NOT NULL DEFAULT 1,
  ADD COLUMN last_seen_at        timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN note                text,
  ADD COLUMN updated_at          timestamptz NOT NULL DEFAULT now();
--> statement-breakpoint
CREATE TRIGGER trg_error_log_entries_updated BEFORE UPDATE ON learn.error_log_entries FOR EACH ROW EXECUTE FUNCTION ops.set_updated_at();
--> statement-breakpoint
CREATE UNIQUE INDEX ux_error_log_user_question ON learn.error_log_entries(user_id, question_id) WHERE question_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX ix_error_log_open ON learn.error_log_entries(user_id, program_code, created_at) WHERE resolved_at IS NULL;
--> statement-breakpoint
ALTER TABLE iam.users ADD COLUMN attribution jsonb;
