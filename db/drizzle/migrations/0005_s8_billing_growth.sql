-- Migration 0005 (spec v1.1 – Sprint 8): hoá đơn điện tử, khuyến mãi đầy đủ, referral, thông báo đa kênh.
-- 1) billing.promotions: điều kiện (conditions jsonb), stackable, tên hiển thị, created_at/updated_at; kind 'amount' → 'fixed'
--    + CHECK 4 loại percent|fixed|credit_bonus|trial_days (SPEC-ISSUES S78).
-- 2) billing.promotion_redemptions: giữ lượt (reserved) khi tạo đơn / đã dùng (redeemed) / nhả (released); đổi mã không qua đơn
--    (trial_days, credit_bonus). Trial một lần/người bằng UNIQUE partial (S79).
-- 3) billing.invoices: ảnh chụp người mua (buyer), cancelled_at, updated_at, index trạng thái cho job invoice.retry (S80).
-- 4) iam.users.referral_code (UNIQUE, cấp lười), iam.referrals: blocked_reason, metadata, started_at, upgraded_at + index
--    chống lạm dụng theo fingerprint/IP (S81).
-- 5) ops.notification_preferences.categories (learning/billing/marketing × email/push/inapp) + index chống trùng
--    ops.notifications theo dedupe_key (S82).
-- KHÔNG sửa tay sau khi phát hành; thay đổi tiếp theo = migration mới + cập nhật docs/spec/allingo-schema.sql.

ALTER TABLE billing.promotions
  ADD COLUMN conditions jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN stackable  boolean NOT NULL DEFAULT false,
  ADD COLUMN name       jsonb,
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
--> statement-breakpoint
UPDATE billing.promotions SET kind = 'fixed' WHERE kind = 'amount';
--> statement-breakpoint
ALTER TABLE billing.promotions ADD CONSTRAINT promotions_kind_check CHECK (kind IN ('percent','fixed','credit_bonus','trial_days'));
--> statement-breakpoint
CREATE TRIGGER trg_promotions_updated BEFORE UPDATE ON billing.promotions FOR EACH ROW EXECUTE FUNCTION ops.set_updated_at();
--> statement-breakpoint
CREATE TABLE billing.promotion_redemptions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id    uuid NOT NULL REFERENCES billing.promotions(id),
  user_id         uuid NOT NULL REFERENCES iam.users(id),
  order_id        uuid UNIQUE REFERENCES billing.orders(id),
  subscription_id uuid REFERENCES billing.subscriptions(id),
  kind            text NOT NULL,
  status          text NOT NULL DEFAULT 'reserved',
  discount        numeric(14,2) NOT NULL DEFAULT 0,
  credits         integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  redeemed_at     timestamptz,
  released_at     timestamptz,
  CHECK (status IN ('reserved','redeemed','released'))
);
--> statement-breakpoint
CREATE INDEX ix_promotion_redemptions_promo_user ON billing.promotion_redemptions(promotion_id, user_id, status);
--> statement-breakpoint
CREATE INDEX ix_promotion_redemptions_user ON billing.promotion_redemptions(user_id, created_at DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX ux_promotion_redemptions_trial_once ON billing.promotion_redemptions(user_id) WHERE kind = 'trial_days' AND status = 'redeemed';
--> statement-breakpoint
ALTER TABLE billing.invoices
  ADD COLUMN buyer        jsonb,
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN updated_at   timestamptz NOT NULL DEFAULT now();
--> statement-breakpoint
CREATE INDEX ix_invoices_status ON billing.invoices(status, created_at);
--> statement-breakpoint
CREATE TRIGGER trg_invoices_updated BEFORE UPDATE ON billing.invoices FOR EACH ROW EXECUTE FUNCTION ops.set_updated_at();
--> statement-breakpoint
ALTER TABLE iam.users ADD COLUMN referral_code text UNIQUE;
--> statement-breakpoint
ALTER TABLE iam.referrals
  ADD COLUMN blocked_reason text,
  ADD COLUMN metadata       jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN started_at     timestamptz,
  ADD COLUMN upgraded_at    timestamptz;
--> statement-breakpoint
CREATE INDEX ix_referrals_fingerprint ON iam.referrals(device_fingerprint, created_at) WHERE device_fingerprint IS NOT NULL;
--> statement-breakpoint
CREATE INDEX ix_referrals_ip ON iam.referrals(ip, created_at) WHERE ip IS NOT NULL;
--> statement-breakpoint
ALTER TABLE ops.notification_preferences
  ADD COLUMN categories jsonb NOT NULL DEFAULT '{"learning":{"email":true,"push":true,"inapp":true},"billing":{"email":true,"push":true,"inapp":true},"marketing":{"email":false,"push":false,"inapp":true}}';
--> statement-breakpoint
CREATE INDEX ix_notifications_dedupe ON ops.notifications(user_id, template_code, ((payload ->> 'dedupe_key'))) WHERE payload ? 'dedupe_key';
