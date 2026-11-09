/**
 * Kiểu dữ liệu API dùng trong web: ưu tiên Zod trong packages/schemas (đầy đủ hơn OpenAPI đã sinh,
 * xem docs/SPEC-ISSUES.md S3/S4). Mọi màn hình import kiểu từ đây, không import trực tiếp openapi.d.ts.
 */
export type {
  User,
  AuthTokens,
  GuestSession,
  UserUpdate,
  Enrollment,
  EnrollmentInput,
  TestSet,
  TestSetSummary,
  Attempt,
  AttemptCreate,
  AttemptMode,
  AttemptAnswerInput,
  AttemptAnswersPut,
  AttemptEvent,
  AttemptResult,
  AttemptReview,
  AttemptSummary,
  AttemptMediaList,
  TranscriptHighlight,
  ToeicScaled,
  SkillBreakdown,
  QuestionPublic,
  Explanation,
  ExplainInput,
  AttemptAiDiagnosis,
  QuotaExceededDetails,
  ListeningUiState,
  Entitlements,
  Stats,
  AnswerInput,
  AnswerInputOf,
  PublicQuestionContent,
  QuestionTypeCode,
  LocalizedText,
  ProgramCode,
  Locale,
} from '@allingo/schemas';
import type { AttemptReview } from '@allingo/schemas/api/attempt';
import type { PublicQuestionContent } from '@allingo/schemas/question/public';

export type ReviewItem = AttemptReview['items'][number];

export interface Page<T> {
  data: T[];
  next_cursor: string | null;
}

/** C1: thêm status/phase/skills/published_test_sets (bổ sung – có thể thiếu với API cũ) */
export type { Program } from '@allingo/schemas/api/core';

/** Ép nội dung câu hỏi (JSONB không answer_key) về union có kiểu; null nếu không nhận ra `type` */
export function asPublicContent(content: Record<string, unknown> | null | undefined): PublicQuestionContent | null {
  if (!content || typeof content.type !== 'string') return null;
  return content as unknown as PublicQuestionContent;
}
