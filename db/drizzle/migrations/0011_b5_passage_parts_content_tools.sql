-- Migration 0011 (spec v1.1 – B5 + B2): Part 7 đa đoạn, metadata đề sinh tự động, phân công duyệt nội dung.
-- 1) catalog.passage_parts (S24): passage bộ đôi/bộ ba TOEIC Part 7 tách từng văn bản (tab trên giao diện). passages.body giữ bản gộp
--    `[Tiêu đề]\n…` làm dự phòng cho client cũ/AI giải thích; passage không có part → hiển thị như trước (tương thích ngược).
-- 2) catalog.test_sets.metadata (S30): seed/blueprint/bank_fingerprint của đề sinh tự động (mini generator, AI soạn đề nháp) – vẫn ghi audit log.
-- 3) catalog.questions.review_assignee_id/review_assigned_at (B2): phân công reviewer trong hàng chờ duyệt + index hàng chờ.
-- KHÔNG sửa tay sau khi phát hành; thay đổi tiếp theo = migration mới + cập nhật docs/spec/allingo-schema.sql.

CREATE TABLE catalog.passage_parts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  passage_id     uuid NOT NULL REFERENCES catalog.passages(id) ON DELETE CASCADE,
  sort_order     smallint NOT NULL,
  title          text,
  body           text NOT NULL,
  media_asset_id uuid REFERENCES catalog.media_assets(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (passage_id, sort_order),
  CHECK (sort_order >= 1)
);
--> statement-breakpoint
CREATE TRIGGER trg_passage_parts_updated BEFORE UPDATE ON catalog.passage_parts FOR EACH ROW EXECUTE FUNCTION ops.set_updated_at();
--> statement-breakpoint
ALTER TABLE catalog.test_sets ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE catalog.questions ADD COLUMN review_assignee_id uuid REFERENCES iam.users(id);
--> statement-breakpoint
ALTER TABLE catalog.questions ADD COLUMN review_assigned_at timestamptz;
--> statement-breakpoint
-- concurrent-safe
CREATE INDEX IF NOT EXISTS ix_questions_review_assignee ON catalog.questions(review_assignee_id) WHERE review_assignee_id IS NOT NULL;
--> statement-breakpoint
-- concurrent-safe
CREATE INDEX IF NOT EXISTS ix_questions_review_queue ON catalog.questions(status, created_at) WHERE status IN ('draft','ai_checked','review1','review2');
