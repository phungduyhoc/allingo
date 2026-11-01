-- Migration 0002 (spec v1.1 – Sprint 2): trạng thái xử lý media cho pipeline `media.process`.
-- uploading → processing → ready | failed; metadata giữ waveform/thumbnail_key/variants/error.
-- Bản ghi cũ (seed/CMS Sprint 0–1) mặc định 'ready' vì đã phát được.
-- KHÔNG sửa tay sau khi phát hành; thay đổi tiếp theo = migration mới + cập nhật docs/spec/allingo-schema.sql.

CREATE TYPE catalog.media_status AS ENUM ('uploading','processing','ready','failed');
--> statement-breakpoint
ALTER TABLE catalog.media_assets
  ADD COLUMN status     catalog.media_status NOT NULL DEFAULT 'ready',
  ADD COLUMN metadata   jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
--> statement-breakpoint
CREATE INDEX ix_media_assets_pending ON catalog.media_assets(status) WHERE status IN ('uploading','processing');
--> statement-breakpoint
CREATE TRIGGER trg_media_assets_updated BEFORE UPDATE ON catalog.media_assets FOR EACH ROW EXECUTE FUNCTION ops.set_updated_at();
