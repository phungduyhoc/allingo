import { z } from 'zod';
import { localizedTextSchema, programCodeSchema, uuidSchema } from '../common.js';
import { answerInputSchema } from '../question/answer.js';
import { questionTypeCodeSchema } from '../question/content.js';
import { noteSchema } from './learning-tools.js';

export const ATTEMPT_MODES = ['exam', 'practice', 'diagnostic', 'drill', 'timed_drill'] as const;
export const attemptModeSchema = z.enum(ATTEMPT_MODES);
export type AttemptMode = z.infer<typeof attemptModeSchema>;
export const ATTEMPT_STATUSES = ['in_progress', 'submitted', 'graded', 'abandoned'] as const;
export const attemptStatusSchema = z.enum(ATTEMPT_STATUSES);

export const attemptCreateSchema = z.object({
  program: programCodeSchema,
  mode: attemptModeSchema,
  test_set_id: uuidSchema.optional(),
  section_id: uuidSchema.optional(),
  plan_task_id: uuidSchema.optional(),
  device: z.record(z.string(), z.unknown()).optional(),
});
export type AttemptCreate = z.infer<typeof attemptCreateSchema>;

export const attemptAnswerInputSchema = z.object({
  question_id: uuidSchema,
  answer: answerInputSchema,
  time_spent_ms: z.number().int().min(0).max(7_200_000).optional(),
  flagged: z.boolean().optional(),
});
export type AttemptAnswerInput = z.infer<typeof attemptAnswerInputSchema>;

/** Vị trí chuỗi phát Listening (bước trong hàng đợi audio + offset trong bước) – khôi phục khi đổi thiết bị/mất localStorage (v1.1 – S5) */
export const listeningUiStateSchema = z.object({
  step: z.number().int().min(0).max(10_000),
  offset_ms: z.number().int().min(0).max(36_000_000),
});
export type ListeningUiState = z.infer<typeof listeningUiStateSchema>;

/** Trạng thái UI để khôi phục: câu hiện tại, phần hiện tại, vị trí phát Listening */
export const attemptUiStateSchema = z.object({
  current_question_id: uuidSchema.optional(),
  current_section_code: z.string().optional(),
  listening: listeningUiStateSchema.optional(),
});
export type AttemptUiState = z.infer<typeof attemptUiStateSchema>;

export const attemptAnswersPutSchema = z.object({
  answers: z.array(attemptAnswerInputSchema).max(100),
  /** Thời gian đã dùng theo section (giây) để khôi phục đồng hồ */
  section_elapsed_sec: z.record(z.string(), z.number().int().min(0)).optional(),
  /** Trạng thái UI để khôi phục: câu hiện tại, phần hiện tại, vị trí phát Listening (`listening`, v1.1 – S5) */
  ui_state: attemptUiStateSchema.optional(),
});
export type AttemptAnswersPut = z.infer<typeof attemptAnswersPutSchema>;

export const ATTEMPT_EVENT_TYPES = ['tab_leave', 'tab_hidden', 'section_timeout', 'audio_played', 'focus_lost', 'resume', 'part_switch', 'audio_started', 'audio_ended', 'audio_stalled'] as const;
/** Sự kiện audio (Sprint 4): `audio_started` (và `audio_played` cũ) tăng `draft_state.audio_plays[question_id]` */
export const AUDIO_EVENT_TYPES: ReadonlySet<string> = new Set(['audio_played', 'audio_started', 'audio_ended', 'audio_stalled']);
export const AUDIO_PLAY_EVENT_TYPES: ReadonlySet<string> = new Set(['audio_played', 'audio_started']);
/** Giới hạn kích thước `meta` của một sự kiện (JSON) – events lưu tối đa 500 mục trong draft_state */
export const ATTEMPT_EVENT_META_MAX_CHARS = 2000;

/** meta của sự kiện audio: câu (Part 3/4: câu đầu nhóm hoặc câu bất kỳ trong nhóm) + asset đang phát */
export const audioEventMetaSchema = z
  .object({
    question_id: uuidSchema.optional(),
    asset_id: uuidSchema.optional(),
    position_ms: z.number().int().min(0).max(36_000_000).optional(),
  })
  .loose();

export const attemptEventSchema = z
  .object({
    /** tab_hidden = visibilitychange (v1.1, Sprint 3); tab_leave giữ để tương thích client Sprint 0 */
    type: z.enum(ATTEMPT_EVENT_TYPES),
    at: z.iso.datetime({ offset: true }).optional(),
    meta: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.meta && JSON.stringify(v.meta).length > ATTEMPT_EVENT_META_MAX_CHARS) ctx.addIssue({ code: 'custom', path: ['meta'], message: `meta must be at most ${ATTEMPT_EVENT_META_MAX_CHARS} characters of JSON` });
    if (v.meta && AUDIO_EVENT_TYPES.has(v.type)) {
      const r = audioEventMetaSchema.safeParse(v.meta);
      if (!r.success) for (const i of r.error.issues) ctx.addIssue({ code: 'custom', path: ['meta', ...i.path.map(String)], message: i.message });
    }
  });
export type AttemptEvent = z.infer<typeof attemptEventSchema>;

/** Trạng thái nháp lưu trong learn.attempts.draft_state */
export const attemptDraftStateSchema = z.object({
  /** Thứ tự question_version_id đã chốt khi tạo attempt (snapshot) */
  question_order: z.array(z.object({ question_id: uuidSchema, question_version_id: uuidSchema, section_code: z.string(), group_key: z.string().nullable(), order_no: z.number().int() })),
  time_limit_sec: z.number().int().nullable(),
  expires_at: z.string().nullable(),
  section_elapsed_sec: z.record(z.string(), z.number().int()).default({}),
  ui_state: attemptUiStateSchema.default({}),
  events: z.array(z.object({ type: z.enum(ATTEMPT_EVENT_TYPES), at: z.string(), meta: z.record(z.string(), z.unknown()).optional() })).max(500).default([]),
  /** Số lần bắt đầu phát audio theo câu (sự kiện audio_started) – cho Review/analytics, server không chặn (v1.1 – Sprint 4) */
  audio_plays: z.record(z.string(), z.number().int().min(0)).default({}),
  answered_count: z.number().int().default(0),
  last_saved_at: z.string().nullable().default(null),
});
export type AttemptDraftState = z.infer<typeof attemptDraftStateSchema>;

export const questionPublicSchema = z.object({
  question_id: uuidSchema,
  question_version_id: uuidSchema,
  question_type: questionTypeCodeSchema,
  section_code: z.string(),
  group_key: z.string().nullable(),
  order_no: z.number().int(),
  /** PublicQuestionContent (không answer_key) */
  content: z.record(z.string(), z.unknown()),
  /**
   * Media của câu (audio/ảnh của câu và của lựa chọn). `expires_at` (v1.1 – Sprint 4): hạn URL ký (null = URL không hết hạn);
   * gia hạn bằng GET /attempts/{id}/media trước khi hết hạn.
   */
  media: z.array(z.object({ id: uuidSchema, kind: z.string(), url: z.string(), duration_ms: z.number().int().nullable(), expires_at: z.string().nullable().optional() })),
  /**
   * Đoạn văn / audio nhóm. Passage `audio_script` (Part 3/4): `body` (transcript) = null khi đang làm bài – chỉ trả trong Review.
   * `media_asset_id` (v1.1) để khớp URL gia hạn từ GET /attempts/{id}/media.
   */
  passage: z
    .object({ id: uuidSchema, kind: z.string(), title: z.string().nullable(), body: z.string().nullable(), media_url: z.string().nullable(), media_asset_id: uuidSchema.nullable().optional(), media_expires_at: z.string().nullable().optional() })
    .nullable(),
});
export type QuestionPublic = z.infer<typeof questionPublicSchema>;

/**
 * Transcript cho Review (ReviewItem.transcript_highlight) và feedback practice/drill (v1.1 – Sprint 4):
 * - `text`: passage audio_script (Part 3/4) hoặc transcript audio của câu (Part 1/2, media_assets.transcript);
 * - `segments`: mốc thời gian (nếu có) để tô sáng câu đang phát;
 * - `evidence`: trích đoạn quyết định đáp án (content.evidence của tác giả).
 */
export const transcriptSegmentSchema = z.object({ start_ms: z.number().int().nullable(), end_ms: z.number().int().nullable(), text: z.string(), speaker: z.string().nullable() });
export const transcriptHighlightSchema = z
  .object({
    text: z.string(),
    segments: z.array(transcriptSegmentSchema).optional(),
    evidence: z.string().nullable(),
    source: z.enum(['passage', 'media', 'evidence']),
    asset_id: uuidSchema.nullable().optional(),
  })
  .loose();
export type TranscriptHighlight = z.infer<typeof transcriptHighlightSchema>;

/** GET /attempts/{id}/media (v1.1 – Sprint 4): URL ký mới cho mọi media của attempt (đề L&R 120′ > TTL 10′) */
export const attemptMediaItemSchema = z.object({ id: uuidSchema, kind: z.string(), url: z.string(), expires_at: z.string().nullable() });
export const attemptMediaListSchema = z.object({ data: z.array(attemptMediaItemSchema) });
export type AttemptMediaList = z.infer<typeof attemptMediaListSchema>;

export const attemptSchema = z.object({
  id: uuidSchema,
  program: programCodeSchema,
  mode: attemptModeSchema,
  status: attemptStatusSchema,
  test_set: z.record(z.string(), z.unknown()).nullable(),
  sections: z.array(z.object({ section_code: z.string(), duration_sec: z.number().int().nullable(), elapsed_sec: z.number().int(), locked: z.boolean() })),
  questions: z.array(questionPublicSchema),
  draft_answers: z.array(attemptAnswerInputSchema),
  started_at: z.string(),
  expires_at: z.string().nullable(),
  server_time: z.string(),
  ui_state: z.record(z.string(), z.unknown()).optional(),
  /**
   * Chỉ chế độ practice/drill: đáp án + đúng/sai của câu ĐÃ trả lời (hiện đáp án ngay – Sprint 3). Không bao giờ có ở exam/timed.
   * `transcript` (v1.1 – Sprint 4): transcript audio của câu; với nhóm Part 3/4 chỉ có khi MỌI câu trong nhóm đã trả lời.
   */
  feedback: z
    .record(z.string(), z.object({ is_correct: z.boolean().nullable(), correct_answer: z.unknown(), explanation: z.record(z.string(), z.string()).nullable(), transcript: transcriptHighlightSchema.nullable().optional() }))
    .optional(),
  /** Số lần đã bắt đầu phát audio theo question_id (từ sự kiện audio_started) – client dùng để giữ quy tắc "nghe một lần" khi tải lại (v1.1) */
  audio_plays: z.record(z.string(), z.number().int()).optional(),
});
export type Attempt = z.infer<typeof attemptSchema>;

/** learn.attempts.score_breakdown */
/** Khoảng ước tính điểm quy đổi */
export const scoreRangeSchema = z.object({ low: z.number(), high: z.number() });
/**
 * Điểm quy đổi TOEIC L&R (v1.1 – Sprint 4) – ƯỚC TÍNH Allingo, không phải bảng chính thức ETS. `total` null khi thiếu một kỹ năng;
 * `range` = khoảng của tổng (10–990) hoặc của kỹ năng duy nhất có mặt; `ranges` từng kỹ năng (5–495).
 */
export const toeicScaledSchema = z.object({
  listening: z.number().nullable(),
  reading: z.number().nullable(),
  total: z.number().nullable(),
  range: scoreRangeSchema.nullable(),
  ranges: z.object({ listening: scoreRangeSchema.nullable(), reading: scoreRangeSchema.nullable() }).optional(),
  estimated: z.literal(true),
});
export type ToeicScaled = z.infer<typeof toeicScaledSchema>;

const countSchema = z.object({ correct: z.number().int(), total: z.number().int() });
/** Thống kê theo kỹ năng (listening/reading/...) gồm subskill/topic của riêng kỹ năng đó và thời gian so cộng đồng (v1.1) */
export const skillBreakdownSchema = z.object({
  correct: z.number().int(),
  total: z.number().int(),
  scaled: z.number().nullable(),
  range: scoreRangeSchema.nullable(),
  avg_time_ms: z.number().int().nullable(),
  community_avg_time_ms: z.number().int().nullable(),
  by_subskill: z.record(z.string(), countSchema),
  by_topic: z.record(z.string(), countSchema),
});
export type SkillBreakdown = z.infer<typeof skillBreakdownSchema>;

export const scoreBreakdownSchema = z.object({
  /** `community_avg_time_ms` (v1.1): trung bình catalog.questions.avg_time_ms của các câu trong Part (so cộng đồng) */
  by_section: z.record(z.string(), z.object({ correct: z.number().int(), total: z.number().int(), avg_time_ms: z.number().int().nullable(), score: z.number().nullable(), community_avg_time_ms: z.number().int().nullable().optional() })),
  by_question_type: z.record(z.string(), z.object({ correct: z.number().int(), total: z.number().int() })),
  by_subskill: z.record(z.string(), z.object({ correct: z.number().int(), total: z.number().int() })),
  by_topic: z.record(z.string(), z.object({ correct: z.number().int(), total: z.number().int() })).default({}),
  unanswered: z.number().int(),
  scale: z.record(z.string(), z.unknown()),
  timeout_wrong: z.number().int().default(0),
  /** Chẩn đoán theo quy tắc (packages/scoring diagnoseAttempt) – Sprint 3 */
  diagnosis: z.record(z.string(), z.unknown()).nullable().optional(),
  auto_submitted: z.boolean().optional(),
  /** v1.1 – Sprint 4 */
  by_skill: z.record(z.string(), skillBreakdownSchema).optional(),
  scaled: toeicScaledSchema.nullable().optional(),
  /** XP đã cộng khi nộp – để GET /attempts/{id}/result trả đúng (attempt cũ không có → 0) */
  xp_earned: z.number().int().optional(),
});
export type ScoreBreakdown = z.infer<typeof scoreBreakdownSchema>;

export const attemptResultSchema = z.object({
  attempt_id: uuidSchema,
  raw_score: z.number(),
  scaled_score: z.number().nullable(),
  scale: z.record(z.string(), z.unknown()),
  by_section: scoreBreakdownSchema.shape.by_section,
  by_question_type: scoreBreakdownSchema.shape.by_question_type,
  by_subskill: scoreBreakdownSchema.shape.by_subskill,
  compared_to_previous: z.object({ scaled_delta: z.number().nullable(), previous_attempt_id: uuidSchema }).nullable(),
  diagnosis: z.record(z.string(), z.unknown()).nullable(),
  xp_earned: z.number().int(),
  /** TOEIC L&R (v1.1 – Sprint 4): điểm Listening/Reading/Tổng + khoảng ước tính; null với chương trình khác */
  scaled: toeicScaledSchema.nullable().optional(),
  by_topic: scoreBreakdownSchema.shape.by_topic.optional(),
  /** Theo kỹ năng: số câu, điểm quy đổi, subskill/topic, thời gian trung bình so cộng đồng (v1.1) */
  by_skill: z.record(z.string(), skillBreakdownSchema).optional(),
});
export type AttemptResult = z.infer<typeof attemptResultSchema>;

export const reviewItemSchema = z.object({
  question: questionPublicSchema,
  your_answer: z.unknown(),
  correct_answer: z.unknown(),
  is_correct: z.boolean().nullable(),
  /** 0–1; null khi câu không chấm tự động (essay/speaking/handwriting) */
  score: z.number().nullable(),
  time_spent_ms: z.number().int().nullable(),
  flagged: z.boolean(),
  details: z.record(z.string(), z.boolean()).nullable(),
  explanation: z.record(z.string(), z.unknown()).nullable(),
  transcript_highlight: z.record(z.string(), z.unknown()).nullable(),
  error_entry_id: uuidSchema.nullable(),
  /** % người làm đúng câu này (cộng đồng) */
  community_correct_rate: z.number().nullable(),
  /** Thời gian trung bình cộng đồng cho câu (catalog.questions.avg_time_ms) – v1.1 */
  community_avg_time_ms: z.number().int().nullable().optional(),
  /** Số lần người học đã bắt đầu phát audio của câu trong attempt (sự kiện audio_started) – v1.1 */
  audio_plays: z.number().int().optional(),
  /** Ghi chú mới nhất của người học cho câu (v1.1 – S6) */
  note: noteSchema.nullable().optional(),
});
export const attemptReviewSchema = z.object({ attempt_id: uuidSchema, items: z.array(reviewItemSchema) });
export type AttemptReview = z.infer<typeof attemptReviewSchema>;

export const attemptSummarySchema = z.object({
  id: uuidSchema,
  program: z.string(),
  mode: attemptModeSchema,
  status: attemptStatusSchema,
  test_set_title: localizedTextSchema.nullable(),
  raw_score: z.number().nullable(),
  scaled_score: z.number().nullable(),
  started_at: z.string(),
  submitted_at: z.string().nullable(),
});
export type AttemptSummary = z.infer<typeof attemptSummarySchema>;

export const myAttemptsQuerySchema = z.object({
  mode: attemptModeSchema.optional(),
  program: programCodeSchema.optional(),
  /** Khoảng ngày bắt đầu (YYYY-MM-DD, theo UTC) – v1.1 */
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  status: attemptStatusSchema.optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** GET /attempts/{id}/review – lọc (v1.1): sai / đánh dấu / theo Part */
export const attemptReviewQuerySchema = z.object({
  only_wrong: z.stringbool().default(false),
  flagged: z.stringbool().default(false),
  section: z.string().max(32).optional(),
});
export type AttemptReviewQuery = z.infer<typeof attemptReviewQuerySchema>;

export const practiceQuestionsQuerySchema = z.object({
  program: programCodeSchema.default('toeic'),
  section: z.string().max(32).optional(),
  question_type: questionTypeCodeSchema.optional(),
  topic: z.string().max(64).optional(),
  subskill: z.string().max(64).optional(),
  count: z.coerce.number().int().min(1).max(50).default(10),
  /** Query string: 'false'/'0' phải là false (z.coerce.boolean coi mọi chuỗi khác rỗng là true) */
  timed: z.stringbool().default(false),
  /** timed_drill: giây cho mỗi câu (ghi đè mặc định theo Part – TIMED_DRILL_SEC_PER_QUESTION) – v1.1 Sprint 4 */
  per_question_sec: z.coerce.number().int().min(5).max(600).optional(),
  /** Từ khoá – tìm qua SearchProvider (Meilisearch/PG), chỉ câu đã phát hành (v1.1) */
  q: z.string().trim().min(2).max(100).optional(),
});

/**
 * timed_drill (Sprint 4): giây mặc định cho mỗi câu theo Part. TOEIC thật: Part 1–2 ~ 5 s nghe + trả lời, Part 3–4 ~ 8 s/câu
 * sau audio (cộng thời lượng audio), Part 5 ~ 25 s, Part 6–7 ~ 60 s đọc. Ước tính để luyện áp lực thời gian, không phải chuẩn ETS.
 */
export const TIMED_DRILL_SEC_PER_QUESTION: Readonly<Record<string, number>> = { part1: 20, part2: 20, part3: 35, part4: 35, part5: 25, part6: 60, part7: 60 };
/** Section không có trong bảng (IELTS/JLPT/HSK…) */
export const TIMED_DRILL_FALLBACK_SEC = 45;

/** Audio Listening chưa biết thời lượng (asset chưa xử lý xong): ước tính bảo thủ (v1.1 – S5) */
export const TIMED_DRILL_UNKNOWN_QUESTION_AUDIO_MS = 6_000;
export const TIMED_DRILL_UNKNOWN_GROUP_AUDIO_MS = 45_000;

export interface TimedDrillItem {
  section_code: string;
  /** Nhóm Part 3/4/6/7 (passage) – audio nhóm chỉ tính một lần */
  group_key?: string | null;
  /** Câu có audio riêng (content.media.audio_asset_id) */
  has_audio?: boolean;
  /** Thời lượng audio của câu (media_assets.duration_ms); null = chưa biết */
  audio_ms?: number | null;
  /** Nhóm có audio chung (passage.media_asset_id) */
  has_group_audio?: boolean;
  /** Thời lượng audio nhóm; null = chưa biết */
  group_audio_ms?: number | null;
  /** content.media.pause_ms – khoảng dừng sau audio */
  pause_ms?: number | null;
}

/**
 * Ngân sách timed_drill (v1.1 – S5): Σ thời gian TRẢ LỜI (per_question_sec, hoặc theo Part) + với câu Listening:
 * audio của câu + pause_ms + audio nhóm (passage, Part 3/4) tính MỘT lần mỗi group_key. Audio chưa rõ thời lượng → ước tính
 * TIMED_DRILL_UNKNOWN_*. Làm tròn lên giây.
 */
export function timedDrillBudgetSeconds(items: readonly TimedDrillItem[], perQuestionSec?: number): number {
  let ms = 0;
  const groups = new Set<string>();
  for (const it of items) {
    ms += (perQuestionSec ?? TIMED_DRILL_SEC_PER_QUESTION[it.section_code] ?? TIMED_DRILL_FALLBACK_SEC) * 1000;
    if (it.has_audio) ms += it.audio_ms ?? TIMED_DRILL_UNKNOWN_QUESTION_AUDIO_MS;
    if (it.has_audio || it.has_group_audio) ms += it.pause_ms ?? 0;
    if (it.has_group_audio) {
      const g = it.group_key ?? `__single_${groups.size}`;
      if (!groups.has(g)) {
        groups.add(g);
        ms += it.group_audio_ms ?? TIMED_DRILL_UNKNOWN_GROUP_AUDIO_MS;
      }
    }
  }
  return Math.ceil(ms / 1000);
}

/** Tổng thời gian TRẢ LỜI timed_drill: Σ giây theo Part từng câu (hoặc per_question_sec × số câu nếu ghi đè) – không gồm audio */
export function timedDrillSeconds(sectionCodes: readonly string[], perQuestionSec?: number): number {
  if (perQuestionSec) return perQuestionSec * sectionCodes.length;
  return sectionCodes.reduce((sum, code) => sum + (TIMED_DRILL_SEC_PER_QUESTION[code] ?? TIMED_DRILL_FALLBACK_SEC), 0);
}
