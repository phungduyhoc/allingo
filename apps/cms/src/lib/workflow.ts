/**
 * Máy trạng thái duyệt nội dung – dùng bản CHUNG trong `@allingo/schemas` (ADR-0024) để CMS và API không lệch nhau.
 * Tệp này chỉ giữ tên gọi quen thuộc trong CMS.
 */
import {
  CONTENT_ROLES,
  CONTENT_STATUSES,
  CONTENT_STATUS_LABELS,
  EDITABLE_CONTENT_STATUSES as SHARED_EDITABLE,
  REVIEW_DECISIONS as SHARED_DECISIONS,
  allowedTargets as sharedAllowedTargets,
  evaluateTransition as sharedEvaluate,
  isContentRole,
  isContentStatus,
  type AiCheckReport,
  type ContentRole,
  type ContentStatus,
  type ReviewDecision as SharedDecision,
  type ReviewStage as SharedStage,
  type TransitionContext as SharedContext,
  type TransitionResult as SharedResult,
} from '@allingo/schemas';

export const QUESTION_STATUSES = CONTENT_STATUSES;
export type QuestionStatus = ContentStatus;
export const CMS_ROLES = CONTENT_ROLES;
export type CmsRole = ContentRole;
export type ReviewStage = SharedStage;
export type ReviewDecision = SharedDecision;
export const REVIEW_DECISIONS: ReadonlyArray<ReviewDecision> = SHARED_DECISIONS;
export type AiReport = AiCheckReport;
export type TransitionContext = SharedContext;
export type TransitionResult = SharedResult;
export const STATUS_LABELS = CONTENT_STATUS_LABELS;
export const EDITABLE_CONTENT_STATUSES = SHARED_EDITABLE;

export const isQuestionStatus = isContentStatus;
export const isCmsRole = isContentRole;
export const allowedTargets = sharedAllowedTargets;
export const evaluateTransition = sharedEvaluate;
