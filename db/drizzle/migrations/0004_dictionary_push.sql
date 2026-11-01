-- Migration 0004 (spec v1.1 – Sprint 6): tra từ (từ điển mở) + Web Push.
-- 1) catalog.vocab_items: forms text[] (headword + dạng biến đổi đã chuẩn hoá, GIN) cho GET /dictionary/lookup tra ngược,
--    topics text[] từ dữ liệu từ điển (SPEC-ISSUES S56).
-- 2) ops.push_subscriptions: đăng ký Web Push (VAPID) theo thiết bị, endpoint UNIQUE (SPEC-ISSUES S57).
-- KHÔNG sửa tay sau khi phát hành; thay đổi tiếp theo = migration mới + cập nhật docs/spec/allingo-schema.sql.

ALTER TABLE catalog.vocab_items
  ADD COLUMN forms  text[] NOT NULL DEFAULT '{}',
  ADD COLUMN topics text[] NOT NULL DEFAULT '{}';
--> statement-breakpoint
CREATE INDEX ix_vocab_items_forms ON catalog.vocab_items USING gin (forms);
--> statement-breakpoint
CREATE TABLE ops.push_subscriptions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
  endpoint        text NOT NULL UNIQUE,
  p256dh          text NOT NULL,
  auth            text NOT NULL,
  expires_at      timestamptz,
  user_agent      text,
  locale          text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz,
  failure_count   smallint NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX ix_push_subscriptions_user ON ops.push_subscriptions(user_id);
--> statement-breakpoint
CREATE TRIGGER trg_push_subscriptions_updated BEFORE UPDATE ON ops.push_subscriptions FOR EACH ROW EXECUTE FUNCTION ops.set_updated_at();
