-- Migration 0006 (spec v1.1 – Sprint 9): lộ trình học – lịch sử đề xuất điều chỉnh (plan_adjust) + index cho job expire.
-- 1) learn.plan_adjustments: mỗi đề xuất (check-in tuần hoặc câu lệnh tự nhiên) – đầu vào đã che PII, đầu ra AI đã validate Zod,
--    trước/sau + thay đổi + vi phạm do server tính (packages/planner applyAdjustOps), trạng thái pending → ready | rejected |
--    needs_clarification | failed → applied | expired | superseded (SPEC-ISSUES S97). ai_task_id là tham chiếu lỏng (ai.ai_tasks partition).
-- 2) ix_plan_tasks_pending_due: job plan.expire_tasks quét task pending quá hạn 3 ngày.
-- KHÔNG sửa tay sau khi phát hành; thay đổi tiếp theo = migration mới + cập nhật docs/spec/allingo-schema.sql.

CREATE TABLE learn.plan_adjustments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id       uuid NOT NULL REFERENCES learn.study_plans(id) ON DELETE CASCADE,
  plan_week_id  uuid REFERENCES learn.plan_weeks(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES iam.users(id) ON DELETE CASCADE,
  source        text NOT NULL,
  status        text NOT NULL DEFAULT 'pending',
  input         jsonb NOT NULL DEFAULT '{}',
  proposal      jsonb,
  result        jsonb,
  ai_task_id    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  applied_at    timestamptz,
  CONSTRAINT plan_adjustments_source_check CHECK (source IN ('checkin','instruction')),
  CONSTRAINT plan_adjustments_status_check CHECK (status IN ('pending','ready','rejected','needs_clarification','applied','expired','failed','superseded'))
);
--> statement-breakpoint
CREATE INDEX ix_plan_adjustments_user ON learn.plan_adjustments(user_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX ix_plan_adjustments_plan ON learn.plan_adjustments(plan_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX ix_plan_tasks_pending_due ON learn.plan_tasks(due_date) WHERE status = 'pending';
