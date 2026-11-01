-- Migration 0003 (spec v1.1 – Sprint 5): AI Gateway mức sản xuất + tóm tắt tiến bộ.
-- 1) ai.ai_tasks: cache_hit / fallback_used / error_code để đo lường & dashboard chi phí (SPEC-ISSUES S37).
-- 2) learn.notes: kind (user | system_summary) + data jsonb cho thẻ tóm tắt summarize_attempt (SPEC-ISSUES S38);
--    unique (user_id, data->>'attempt_id') cho system_summary → job summary.attempt idempotent.
-- 3) Index phục vụ invalidation cache giải thích theo prompt_version_id và tra eval run theo phiên bản prompt.
-- KHÔNG sửa tay sau khi phát hành; thay đổi tiếp theo = migration mới + cập nhật docs/spec/allingo-schema.sql.

ALTER TABLE ai.ai_tasks
  ADD COLUMN cache_hit     boolean NOT NULL DEFAULT false,
  ADD COLUMN fallback_used boolean NOT NULL DEFAULT false,
  ADD COLUMN error_code    text;
--> statement-breakpoint
ALTER TABLE learn.notes
  ADD COLUMN kind text NOT NULL DEFAULT 'user',
  ADD COLUMN data jsonb,
  ADD CONSTRAINT notes_kind_check CHECK (kind IN ('user','system_summary'));
--> statement-breakpoint
CREATE INDEX ix_notes_user_kind ON learn.notes(user_id, kind, updated_at DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX ux_notes_system_summary ON learn.notes(user_id, (data->>'attempt_id')) WHERE kind = 'system_summary';
--> statement-breakpoint
CREATE INDEX ix_explanation_cache_prompt ON ai.explanation_cache(prompt_version_id);
--> statement-breakpoint
CREATE INDEX ix_eval_runs_version ON ai.eval_runs(prompt_version_id, run_at DESC);
