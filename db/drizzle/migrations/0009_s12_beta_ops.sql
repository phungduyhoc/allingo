-- Migration 0009 (spec v1.1 – Sprint 12): beta kín, phản hồi & hỗ trợ, admin vận hành, MFA admin, thống kê câu hỏi.
-- 1) iam.consent_type += 'refund_policy' (chính sách hoàn tiền có phiên bản; đồng ý giọng nói dùng 'voice_processing' sẵn có – S131).
-- 2) iam.roles += 'beta_tester' (cấp khi đổi mã mời – JWT mang vai trò sau lần refresh kế tiếp; guard đọc DB/cache ngay).
-- 3) iam.sessions.mfa_verified_at: phiên đã xác minh TOTP (step-up) – refresh giữ claim `mfa`.
-- 4) iam.mfa_factors: TOTP RFC 6238 cho admin/superadmin – secret mã hoá AES-256-GCM, chống dùng lại bước, mã khôi phục (băm).
-- 5) ops.waitlist_entries: đăng ký chờ (landing S10) – email citext, chống trùng (email, program).
-- 6) ops.beta_invites: mã mời đơn dùng một lần (chỉ lưu sha256), gửi theo đợt (mặc định 50/ngày), một người đổi tối đa một mã.
-- 7) ops.survey_responses: khảo sát onboarding beta (5 câu, JSONB) + NPS ngày 7/14 (một lần mỗi loại).
-- 8) ops.content_reports: message, resolution_note, sla_due_at (48 giờ), updated_at + index hàng đợi duyệt + một báo cáo mở/người/câu.
-- 9) ops.support_tickets: category, context, SLA phản hồi 24 giờ, mốc phản hồi/tin cuối/đóng; ops.support_messages (2 chiều).
-- 10) ops.feedback: index trạng thái cho hàng đợi admin.
-- 11) catalog.questions.stats/stats_updated_at: p-value, point-biserial, thời gian TB, số báo lỗi, đề xuất retire (job content.stats_nightly).
-- 12) ops.audit_logs(action, created_at): tìm kiếm GET /admin/audit-logs.
-- 13) ops.jobs_deadletter: job_name, replayed_at, replay_count (POST /admin/jobs/dead-letters/{id}/replay).
-- KHÔNG sửa tay sau khi phát hành; thay đổi tiếp theo = migration mới + cập nhật docs/spec/allingo-schema.sql.

ALTER TYPE iam.consent_type ADD VALUE IF NOT EXISTS 'refund_policy';
--> statement-breakpoint
INSERT INTO iam.roles (code, description) VALUES ('beta_tester', 'Người thử nghiệm beta kín (S12)') ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
ALTER TABLE iam.sessions ADD COLUMN mfa_verified_at timestamptz;
--> statement-breakpoint
CREATE TABLE iam.mfa_factors (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
  kind           text NOT NULL DEFAULT 'totp',
  secret_enc     text NOT NULL,
  confirmed_at   timestamptz,
  last_used_step bigint,
  recovery_codes jsonb NOT NULL DEFAULT '[]',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind),
  CHECK (kind IN ('totp'))
);
--> statement-breakpoint
CREATE TRIGGER trg_mfa_factors_updated BEFORE UPDATE ON iam.mfa_factors FOR EACH ROW EXECUTE FUNCTION ops.set_updated_at();
--> statement-breakpoint
CREATE TABLE ops.waitlist_entries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             citext NOT NULL,
  program           text NOT NULL,
  locale            text NOT NULL DEFAULT 'vi',
  consent_marketing boolean NOT NULL DEFAULT false,
  source            text,
  status            text NOT NULL DEFAULT 'waiting',
  ip_hash           text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email, program),
  CHECK (status IN ('waiting','invited','joined','removed'))
);
--> statement-breakpoint
CREATE INDEX ix_waitlist_entries_status ON ops.waitlist_entries(program, status, created_at);
--> statement-breakpoint
CREATE TRIGGER trg_waitlist_entries_updated BEFORE UPDATE ON ops.waitlist_entries FOR EACH ROW EXECUTE FUNCTION ops.set_updated_at();
--> statement-breakpoint
CREATE TABLE ops.beta_invites (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             citext NOT NULL,
  waitlist_entry_id uuid REFERENCES ops.waitlist_entries(id) ON DELETE SET NULL,
  program           text NOT NULL DEFAULT 'toeic',
  locale            text NOT NULL DEFAULT 'vi',
  code_hash         text UNIQUE,
  status            text NOT NULL DEFAULT 'queued',
  batch             text,
  created_by        uuid REFERENCES iam.users(id) ON DELETE SET NULL,
  sent_at           timestamptz,
  expires_at        timestamptz,
  send_attempts     smallint NOT NULL DEFAULT 0,
  last_error        text,
  redeemed_by       uuid REFERENCES iam.users(id) ON DELETE SET NULL,
  redeemed_at       timestamptz,
  grant_result      jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('queued','sent','redeemed','revoked','expired','failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX ux_beta_invites_email_active ON ops.beta_invites(email) WHERE status IN ('queued','sent','redeemed');
--> statement-breakpoint
CREATE UNIQUE INDEX ux_beta_invites_redeemed_by ON ops.beta_invites(redeemed_by) WHERE redeemed_by IS NOT NULL;
--> statement-breakpoint
CREATE INDEX ix_beta_invites_status ON ops.beta_invites(status, created_at);
--> statement-breakpoint
CREATE TRIGGER trg_beta_invites_updated BEFORE UPDATE ON ops.beta_invites FOR EACH ROW EXECUTE FUNCTION ops.set_updated_at();
--> statement-breakpoint
CREATE TABLE ops.survey_responses (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
  kind       text NOT NULL,
  answers    jsonb NOT NULL DEFAULT '{}',
  score      smallint,
  comment    text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind),
  CHECK (kind IN ('beta_onboarding','nps_d7','nps_d14')),
  CHECK (score IS NULL OR score BETWEEN 0 AND 10)
);
--> statement-breakpoint
CREATE INDEX ix_survey_responses_kind ON ops.survey_responses(kind, created_at);
--> statement-breakpoint
ALTER TABLE ops.content_reports
  ADD COLUMN message         text,
  ADD COLUMN resolution_note text,
  ADD COLUMN sla_due_at      timestamptz,
  ADD COLUMN updated_at      timestamptz NOT NULL DEFAULT now();
--> statement-breakpoint
-- migration-guard: allow index dùng cột sla_due_at mới thêm ở trên (không tạo trước CONCURRENTLY được); bảng báo lỗi nhỏ (beta)
CREATE INDEX IF NOT EXISTS ix_content_reports_status_due ON ops.content_reports(status, sla_due_at);
--> statement-breakpoint
-- concurrent-safe
CREATE UNIQUE INDEX IF NOT EXISTS ux_content_reports_open_per_user ON ops.content_reports(user_id, entity_type, entity_id) WHERE status = 'open';
--> statement-breakpoint
CREATE TRIGGER trg_content_reports_updated BEFORE UPDATE ON ops.content_reports FOR EACH ROW EXECUTE FUNCTION ops.set_updated_at();
--> statement-breakpoint
ALTER TABLE ops.support_tickets
  ADD COLUMN category              text NOT NULL DEFAULT 'other',
  ADD COLUMN context               jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN first_response_due_at timestamptz,
  ADD COLUMN first_responded_at    timestamptz,
  ADD COLUMN last_message_at       timestamptz,
  ADD COLUMN closed_at             timestamptz;
--> statement-breakpoint
-- concurrent-safe
CREATE INDEX IF NOT EXISTS ix_support_tickets_user ON ops.support_tickets(user_id, created_at DESC);
--> statement-breakpoint
-- migration-guard: allow index dùng cột first_response_due_at mới thêm ở trên; bảng ticket nhỏ (beta)
CREATE INDEX IF NOT EXISTS ix_support_tickets_status ON ops.support_tickets(status, first_response_due_at);
--> statement-breakpoint
CREATE TRIGGER trg_support_tickets_updated BEFORE UPDATE ON ops.support_tickets FOR EACH ROW EXECUTE FUNCTION ops.set_updated_at();
--> statement-breakpoint
CREATE TABLE ops.support_messages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id      uuid NOT NULL REFERENCES ops.support_tickets(id) ON DELETE CASCADE,
  author_user_id uuid REFERENCES iam.users(id) ON DELETE SET NULL,
  author_kind    text NOT NULL,
  body           text NOT NULL,
  delivery       jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (author_kind IN ('user','agent','system'))
);
--> statement-breakpoint
CREATE INDEX ix_support_messages_ticket ON ops.support_messages(ticket_id, created_at);
--> statement-breakpoint
-- concurrent-safe
CREATE INDEX IF NOT EXISTS ix_feedback_status ON ops.feedback(status, created_at DESC);
--> statement-breakpoint
ALTER TABLE catalog.questions
  ADD COLUMN stats            jsonb,
  ADD COLUMN stats_updated_at timestamptz;
--> statement-breakpoint
-- concurrent-safe
CREATE INDEX IF NOT EXISTS ix_audit_logs_action ON ops.audit_logs(action, created_at DESC);
--> statement-breakpoint
ALTER TABLE ops.jobs_deadletter
  ADD COLUMN job_name     text,
  ADD COLUMN replayed_at  timestamptz,
  ADD COLUMN replay_count smallint NOT NULL DEFAULT 0;
