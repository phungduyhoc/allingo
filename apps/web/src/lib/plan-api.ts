import { ApiError, unwrap } from '@allingo/api-client';
import { badgeListSchema, diagnosticStepSchema, planAdjustApplyResultSchema, planAdjustListSchema, planAdjustProposalSchema, planCheckinResultSchema, planRegenerateResultSchema, planTaskSchema, planTodaySchema, studyPlanSchema, type DiagnosticStep, type PlanAdjustProposal, type PlanCheckinInput, type PlanCreateInput, type PlanTask, type PlanTaskPatch, type PlanToday, type PlanWeek, type StudyPlan } from '@allingo/schemas/api/learning-plan';
import { vocabItemSchema, type VocabItem } from '@allingo/schemas/api/learning-s10';
import { type LocalizedText } from '@allingo/schemas/common';
import { type AnswerInput } from '@allingo/schemas/question/answer';
import type { z } from 'zod';
import { getApi } from './api';
import { pageOf, parseOr } from './zod-parse';
import type { Attempt, AttemptCreate, Page } from './types';

/**
 * Lời gọi API Sprint 9 – chẩn đoán thích ứng, lộ trình tuần, hôm nay, task, check-in & đề xuất điều chỉnh, huy hiệu
 * (docs/spec/allingo-openapi.yaml v1.1; kiểu chính xác ở `packages/schemas/src/api/learning-plan.ts`). Hàm thuần dùng trong
 * hook TanStack (`features/plan/queries.ts`). Phản hồi validate bằng Zod; sai dạng → dữ liệu thô (server là nguồn sự thật).
 */

export type PlanCheckinResult = z.infer<typeof planCheckinResultSchema>;
export type PlanAdjustApplyResult = z.infer<typeof planAdjustApplyResultSchema>;
export type PlanRegenerateResult = z.infer<typeof planRegenerateResultSchema>;
export type BadgeList = z.infer<typeof badgeListSchema>;

// ----------------------------------------------------------------------------- Chẩn đoán

/** POST /me/diagnostic – bắt đầu hoặc tiếp tục bài đang làm (trả câu đang chờ) */
export async function startDiagnostic(program: string): Promise<DiagnosticStep> {
  return parseOr(diagnosticStepSchema, unwrap(await getApi().POST('/me/diagnostic', { body: { program } as never })));
}

/** GET /me/diagnostic/{id}/next – lấy lại câu đang chờ / kết quả (không chấm) */
export async function getDiagnosticStep(attemptId: string): Promise<DiagnosticStep> {
  return parseOr(
    diagnosticStepSchema,
    unwrap(await getApi().GET('/me/diagnostic/{attemptId}/next', { params: { path: { attemptId } } as never })),
  );
}

export interface DiagnosticAnswerBody {
  question_id: string;
  answer: AnswerInput;
  time_spent_ms?: number;
}

/** POST /me/diagnostic/{id}/next – trả lời câu đang chờ; 409 `details.current_question_id` khi gửi nhầm câu / đã xong */
export async function answerDiagnostic(attemptId: string, body: DiagnosticAnswerBody): Promise<DiagnosticStep> {
  return parseOr(
    diagnosticStepSchema,
    unwrap(await getApi().POST('/me/diagnostic/{attemptId}/next', { params: { path: { attemptId } }, body: body as never } as never)),
  );
}

// ----------------------------------------------------------------------------- Lộ trình

/** GET /me/plan – 404 (chưa có lộ trình) → null */
export async function getPlan(program: string): Promise<StudyPlan | null> {
  const res = await getApi().GET('/me/plan', { params: { query: { program } } as never });
  if (res.response.status === 404) return null;
  return parseOr(studyPlanSchema, unwrap(res));
}

/** POST /me/plan (201) – từ onboarding; 400 múi giờ/ngày thi/ngày học sai; 503 `feature_disabled` */
export async function createPlan(input: PlanCreateInput): Promise<StudyPlan> {
  return parseOr(studyPlanSchema, unwrap(await getApi().POST('/me/plan', { body: input as never })));
}

/** POST /me/plan/regenerate → 202 {job_id, status, plan_id}; kết quả cuối qua realtime `plan.updated` (reason generated) */
export async function regeneratePlan(program: string): Promise<PlanRegenerateResult> {
  return parseOr(planRegenerateResultSchema, unwrap(await getApi().POST('/me/plan/regenerate', { body: { program } as never })));
}

export async function getToday(program: string): Promise<PlanToday> {
  return parseOr(planTodaySchema, unwrap(await getApi().GET('/me/plan/today', { params: { query: { program } } as never })));
}

/** PATCH /plan-tasks/{id}: done/skipped/pending, gắn kết quả, đổi ngày TRONG tuần (400 khi sai luật; 403 khác chủ) */
export async function patchPlanTask(taskId: string, patch: PlanTaskPatch): Promise<PlanTask> {
  return parseOr(
    planTaskSchema,
    unwrap(await getApi().PATCH('/plan-tasks/{taskId}', { params: { path: { taskId } }, body: patch as never } as never)),
  );
}

// ----------------------------------------------------------------------------- Check-in & điều chỉnh

export async function submitCheckin(input: PlanCheckinInput): Promise<PlanCheckinResult> {
  return parseOr(planCheckinResultSchema, unwrap(await getApi().POST('/me/plan/checkin', { body: input as never })));
}

export async function listProposals(program: string, limit = 10): Promise<PlanAdjustProposal[]> {
  const data = unwrap(await getApi().GET('/me/plan/adjust', { params: { query: { program, limit } } as never }));
  const parsed = planAdjustListSchema.safeParse(data);
  if (parsed.success) return parsed.data.data;
  return ((data as { data?: unknown[] } | null)?.data ?? []).map((x) => parseOr(planAdjustProposalSchema, x));
}

/** POST /me/plan/adjust – 200 (đã có kết quả) hoặc 202 (job còn chạy, status pending); 402 thiếu credit; 400 `refusal_code` */
export async function instructAdjust(program: string, instruction: string): Promise<{ proposal: PlanAdjustProposal; accepted: boolean }> {
  const res = await getApi().POST('/me/plan/adjust', { body: { program, instruction } as never });
  return { proposal: parseOr(planAdjustProposalSchema, unwrap(res)), accepted: res.response.status === 202 };
}

/** POST /me/plan/adjust/{id}/apply → {proposal, week}; 409 `details{status, violations}` (áp lại đề xuất đã áp → 200) */
export async function applyProposal(proposalId: string): Promise<PlanAdjustApplyResult> {
  return parseOr(
    planAdjustApplyResultSchema,
    unwrap(await getApi().POST('/me/plan/adjust/{proposalId}/apply', { params: { path: { proposalId } } } as never)),
  );
}

// ----------------------------------------------------------------------------- Huy hiệu

export async function getBadges(program: string): Promise<BadgeList> {
  const data = unwrap(await getApi().GET('/me/badges', { params: { query: { program } } as never }));
  return parseOr(badgeListSchema, data);
}

// ----------------------------------------------------------------------------- Mở nội dung của task

/** POST /attempts với `plan_task_id` (Idempotency-Key ổn định theo task để bấm đúp không tạo hai lượt) */
export async function createPlanAttempt(body: AttemptCreate, idempotencyKey: string): Promise<Attempt> {
  return unwrap(
    await getApi().POST('/attempts', { params: { header: { 'Idempotency-Key': idempotencyKey } }, body: body as never }),
  ) as unknown as Attempt;
}

/** S10: task `review_errors` → POST /me/errors/drill {plan_task_id} (404 = không còn lỗi chưa hiểu) */
export async function createErrorsDrill(program: string, planTaskId: string): Promise<Attempt> {
  return unwrap(await getApi().POST('/me/errors/drill', { body: { program, plan_task_id: planTaskId } as never })) as unknown as Attempt;
}

export interface LessonStep {
  step_no: number;
  type: string;
  content: Record<string, unknown> | null;
}
export interface LessonDetail {
  id: string;
  program: string;
  kind: string;
  title: LocalizedText;
  summary: LocalizedText | null;
  est_minutes: number | null;
  is_free: boolean;
  steps: LessonStep[];
}

export async function getLesson(lessonId: string): Promise<LessonDetail> {
  return unwrap(await getApi().GET('/lessons/{lessonId}', { params: { path: { lessonId } } })) as unknown as LessonDetail;
}

export async function getVocabListItems(listId: string, cursor?: string | null): Promise<Page<VocabItem>> {
  const query = { limit: 50, ...(cursor ? { cursor } : {}) };
  return pageOf(vocabItemSchema, unwrap(await getApi().GET('/vocab/lists/{listId}/items', { params: { path: { listId }, query } })));
}

/** Lỗi 409 của apply/next: chi tiết `{status, violations, current_question_id, reason}` */
export function conflictDetails(err: unknown): Record<string, unknown> | null {
  return err instanceof ApiError && err.status === 409 ? (err.details ?? {}) : null;
}

export type { PlanWeek };
