import { z } from 'zod';
import { isoDateSchema, localizedTextSchema, programCodeSchema, uuidSchema } from '../common.js';
import { questionPublicSchema, transcriptHighlightSchema } from './attempt.js';
import { srsCardSchema, SRS_CARD_TYPES, SRS_STATES } from './learning-tools.js';

/**
 * Hợp đồng Sprint 10 (v1.1): ôn tập FSRS (GET /me/srs/due, POST /me/srs/review, GET /me/srs/cards), bộ từ hệ thống
 * (GET /vocab/lists, /vocab/lists/{id}/items, POST /vocab/lists/{id}/enroll), sổ lỗi (GET /me/errors, PATCH /me/errors/{id},
 * POST /me/errors/drill), dự báo điểm v0 (GET /me/forecast), attribution khi đăng ký, sự kiện phễu server-side.
 */

// ----------------------------------------------------------------------------- SRS
export const srsDueQuerySchema = z.object({
  program: programCodeSchema.default('toeic'),
  card_type: z.enum(SRS_CARD_TYPES).optional(),
  list_id: uuidSchema.optional(),
  /** Số thẻ tối đa trả về (phiên 10–30 thẻ) */
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const srsDueListSchema = z.object({
  /** Thẻ đến hạn (learning/relearning trước, rồi review quá hạn lâu nhất) + thẻ mới trong hạn mức ngày */
  data: z.array(srsCardSchema),
  counts: z.object({
    /** Thẻ đã học đến hạn tới cuối ngày hôm nay (giờ người học), không gồm thẻ mới */
    due: z.number().int(),
    /** Thẻ đến hạn ngay (due_at ≤ now) */
    due_now: z.number().int(),
    /** Thẻ mới chưa học (tổng) */
    new_total: z.number().int(),
    /** Hạn mức thẻ mới/ngày theo gói (billing.quotas srs_new_cards – Free 10, Pro 30); null = không giới hạn */
    new_limit: z.number().int().nullable(),
    /** Thẻ mới đã học hôm nay (giờ VN, quota ngày) */
    new_used_today: z.number().int(),
    /** Thẻ mới còn được học hôm nay */
    new_remaining: z.number().int().nullable(),
    /** Thẻ mới có trong `data` */
    new_in_session: z.number().int(),
  }),
  /** Hạn gần nhất trong tương lai (thẻ learning quay lại sau vài phút / ngày mai) */
  next_due_at: z.string().nullable(),
  new_resets_at: z.string().nullable(),
  server_time: z.string(),
});
export type SrsDueList = z.infer<typeof srsDueListSchema>;

export const SRS_REVIEW_MODES = ['flashcard', 'gap_fill', 'listen_type', 'match', 'use_in_sentence', 'dictation'] as const;
export const srsReviewInputSchema = z.object({
  reviews: z
    .array(
      z.object({
        card_id: uuidSchema,
        rating: z.number().int().min(1).max(4),
        review_mode: z.enum(SRS_REVIEW_MODES).optional(),
        /** v1.1 – S10: thời điểm người học chấm (client) – khoá idempotent (card_id, reviewed_at); thiếu → giờ server */
        reviewed_at: z.iso.datetime({ offset: true }).optional(),
      }),
    )
    .min(1)
    .max(100),
});
export type SrsReviewInput = z.infer<typeof srsReviewInputSchema>;

export const srsCardListQuerySchema = z.object({
  program: programCodeSchema.default('toeic'),
  card_type: z.enum(SRS_CARD_TYPES).optional(),
  state: z.enum(SRS_STATES).optional(),
  list_id: uuidSchema.optional(),
  /** Tìm theo headword (thẻ vocab) */
  q: z.string().trim().max(100).optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ----------------------------------------------------------------------------- Bộ từ
export const vocabListCountsSchema = z.object({ total: z.number().int(), new: z.number().int(), learning: z.number().int(), due: z.number().int(), mastered: z.number().int(), enrolled: z.number().int() });
export const vocabListSchema = z.object({
  id: uuidSchema,
  program: z.string(),
  kind: z.string(),
  title: localizedTextSchema,
  is_free: z.boolean(),
  sort_order: z.number().int(),
  /** Chủ đề (topic list) – mã office/finance… */
  topic: z.string().nullable(),
  counts: vocabListCountsSchema,
  /** Đã thêm ít nhất một thẻ của bộ */
  enrolled: z.boolean(),
  /** enroll | review | learn_new | done – web dịch qua next-intl (`vocab.next_action.<code>`) */
  next_action_code: z.enum(['enroll', 'review', 'learn_new', 'done']),
  /** Spec: chuỗi hiển thị (vi/en theo người học), ví dụ "Ôn 20" */
  next_action: z.string(),
});
export type VocabList = z.infer<typeof vocabListSchema>;

export const vocabItemSchema = z.object({
  id: uuidSchema,
  kind: z.string(),
  headword: z.string(),
  reading: z.string().nullable(),
  sino_vietnamese: z.string().nullable(),
  pos: z.string().nullable(),
  ipa_uk: z.string().nullable(),
  ipa_us: z.string().nullable(),
  audio_uk_url: z.string().nullable(),
  audio_us_url: z.string().nullable(),
  meanings: z.unknown(),
  examples: z.array(z.unknown()),
  collocations: z.array(z.string()),
  level: z.string().nullable(),
  topics: z.array(z.string()),
  sort_order: z.number().int(),
  srs: srsCardSchema.nullable(),
});
export type VocabItem = z.infer<typeof vocabItemSchema>;

export const vocabListItemsQuerySchema = z.object({ cursor: z.string().max(512).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });

export const vocabEnrollResultSchema = z.object({
  list_id: uuidSchema,
  total: z.number().int(),
  /** Thẻ mới tạo (state new) */
  added: z.number().int(),
  /** Đã có thẻ từ trước (không đổi lịch) */
  existing: z.number().int(),
  /** Thẻ mới được học mỗi ngày theo gói – để web hiển thị "mỗi ngày N từ mới" */
  new_per_day: z.number().int().nullable(),
});
export type VocabEnrollResult = z.infer<typeof vocabEnrollResultSchema>;

// ----------------------------------------------------------------------------- Sổ lỗi
/** Theo enum DDL learn.error_kind */
export const ERROR_KINDS = ['paraphrase', 'trap', 'vocabulary', 'timeout', 'grammar', 'listening_detail', 'inference', 'spelling', 'tone', 'pronunciation', 'other'] as const;
export type ErrorKind = (typeof ERROR_KINDS)[number];
export const errorKindSchema = z.enum(ERROR_KINDS);

export const errorLogQuerySchema = z.object({
  program: programCodeSchema.default('toeic'),
  kind: errorKindSchema.optional(),
  /** Mã section (part1…part7) */
  part: z.string().max(32).optional(),
  status: z.enum(['open', 'resolved', 'all']).default('open'),
  /** Cửa sổ ngày theo lần sai gần nhất (spec: 7/30); 0 = không giới hạn; thiếu → 30 (sort newest) / 0 (sort oldest). Bỏ qua khi có from/to */
  days: z.coerce.number().int().min(0).max(3650).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  /** newest (lần sai gần nhất trước) | oldest (lỗi cũ nhất trước – task review_errors) */
  sort: z.enum(['newest', 'oldest']).default('newest'),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ErrorLogQuery = z.infer<typeof errorLogQuerySchema>;

export const errorLogEntrySchema = z.object({
  id: uuidSchema,
  /** Loại hiệu lực = reason_override ?? error_kind */
  kind: errorKindSchema,
  kind_auto: errorKindSchema,
  reason_auto: z.record(z.string(), z.unknown()),
  reason_override: errorKindSchema.nullable(),
  question: questionPublicSchema.nullable(),
  /** S12 (fix web S10): transcript/chữ được đọc trong audio (Part 1–4) – như review; null nếu không có */
  transcript_highlight: transcriptHighlightSchema.nullable().optional(),
  question_id: uuidSchema.nullable(),
  question_version_id: uuidSchema.nullable(),
  section_code: z.string().nullable(),
  subskill: z.string().nullable(),
  topic: z.string().nullable(),
  your_answer: z.unknown(),
  correct_answer: z.unknown(),
  time_spent_ms: z.number().int().nullable(),
  occurrences: z.number().int(),
  note: z.string().nullable(),
  resolved: z.boolean(),
  resolved_at: z.string().nullable(),
  srs_card_id: uuidSchema.nullable(),
  attempt_id: uuidSchema.nullable(),
  created_at: z.string(),
  last_seen_at: z.string(),
});
export type ErrorLogEntry = z.infer<typeof errorLogEntrySchema>;

export const errorLogPageSchema = z.object({
  /** Số lỗi theo loại (theo bộ lọc thời gian/part/trạng thái, không theo `kind`) */
  distribution: z.record(z.string(), z.number().int()),
  /** v1.1 – S10: theo Part */
  by_section: z.record(z.string(), z.number().int()),
  /** v1.1 – S10: tổng chưa hiểu / đã hiểu (mọi thời gian) */
  totals: z.object({ open: z.number().int(), resolved: z.number().int() }),
  /** AI gán nhãn paraphrase ở GĐ2 – S10 luôn rỗng */
  paraphrase_map: z.array(z.object({ question_said: z.string(), passage_said: z.string(), count: z.number().int() })),
  recurring_writing_speaking: z.array(z.record(z.string(), z.unknown())),
  data: z.array(errorLogEntrySchema),
  next_cursor: z.string().nullable(),
});
export type ErrorLogPage = z.infer<typeof errorLogPageSchema>;

export const errorPatchSchema = z
  .object({
    reason_override: errorKindSchema.nullable().optional(),
    /** true = "đã hiểu" (biến mất khỏi task review_errors); false = mở lại */
    resolved: z.boolean().optional(),
    note: z.string().trim().max(1000).nullable().optional(),
    /** Tạo thẻ SRS kind `error` (idempotent) */
    create_card: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'empty patch' });
export type ErrorPatch = z.infer<typeof errorPatchSchema>;

export const ERROR_DRILL_MAX = 10;
export const errorDrillInputSchema = z.object({
  program: programCodeSchema.default('toeic'),
  /** Chọn đúng các lỗi (≤ 10, của chính người học, chưa hiểu); thiếu → 10 lỗi chưa hiểu cũ nhất theo bộ lọc */
  entry_ids: z.array(uuidSchema).min(1).max(ERROR_DRILL_MAX).optional(),
  kind: errorKindSchema.optional(),
  part: z.string().max(32).optional(),
  limit: z.number().int().min(1).max(ERROR_DRILL_MAX).default(ERROR_DRILL_MAX),
  /** Task review_errors của lộ trình (tự done khi bài drill được chấm) */
  plan_task_id: uuidSchema.optional(),
});
export type ErrorDrillInput = z.infer<typeof errorDrillInputSchema>;

// ----------------------------------------------------------------------------- Thang điểm từng điểm số (S12 – fix web S10)
/**
 * Phần điểm của một bài: `total` (thang tổng – TOEIC 10–990) hoặc một kỹ năng (`listening`/`reading` – TOEIC 5–495, khi đề chỉ có
 * một kỹ năng, vd mini Listening). current_estimate/forecast chỉ dùng điểm `total`.
 */
export const SCORE_PARTS = ['total', 'listening', 'reading'] as const;
export const scorePartSchema = z.enum(SCORE_PARTS);
export type ScorePart = (typeof SCORE_PARTS)[number];
export function scorePartOf(scaled: { total?: number | null; listening?: number | null; reading?: number | null } | null | undefined): ScorePart {
  if (!scaled) return 'total';
  if (scaled.total !== null && scaled.total !== undefined) return 'total';
  const l = scaled.listening !== null && scaled.listening !== undefined;
  const r = scaled.reading !== null && scaled.reading !== undefined;
  // Bản ghi cũ không có khoá total nhưng đủ hai kỹ năng → thang tổng
  if (l && r) return 'total';
  if (l) return 'listening';
  if (scaled.reading !== null && scaled.reading !== undefined) return 'reading';
  return 'total';
}
export function scoreScaleOf(program: string, part: ScorePart): { min: number; max: number } {
  if (program === 'toeic') return part === 'total' ? { min: 10, max: 990 } : { min: 5, max: 495 };
  if (program === 'ielts') return { min: 0, max: 9 };
  if (program === 'jlpt') return { min: 0, max: 180 };
  return { min: 0, max: 300 };
}

// ----------------------------------------------------------------------------- Thống kê (mở rộng Stats – S10)
const accuracyCell = z.object({ correct: z.number().int(), total: z.number().int(), accuracy: z.number().nullable() });
export const accuracyCompareSchema = z.object({ current: accuracyCell, previous: accuracyCell, delta: z.number().nullable() });
export const statsS10Schema = z.object({
  /** Điểm theo thời gian: bài có thang điểm (exam/mini/full/diagnostic) */
  score_history: z.array(z.object({ date: z.string(), at: z.string(), score: z.number(), listening: z.number().nullable(), reading: z.number().nullable(), kind: z.string().nullable(), mode: z.string(), attempt_id: uuidSchema, part: scorePartSchema.optional(), scale: z.object({ min: z.number(), max: z.number() }).optional() })),
  /** Độ chính xác 30 ngày gần nhất vs 30 ngày trước đó theo Part và subskill */
  accuracy: z.object({ window_days: z.number().int(), by_section: z.record(z.string(), accuracyCompareSchema), by_subskill: z.record(z.string(), accuracyCompareSchema) }),
  /** Phút học theo tuần (8 tuần, thứ Hai đầu tuần theo giờ người học): bài làm + ôn thẻ (ước tính 10 giây/thẻ) */
  minutes_by_week: z.array(z.object({ week_start: z.string(), minutes: z.number().int(), attempts: z.number().int(), reviews: z.number().int() })),
  vocab: z.object({ total: z.number().int(), new: z.number().int(), learning: z.number().int(), mastered: z.number().int(), due_today: z.number().int(), reviews_7d: z.number().int() }),
  errors: z.object({ open: z.number().int(), resolved: z.number().int(), by_kind: z.record(z.string(), z.number().int()) }),
  /** So với người học cùng chương trình + cùng mức mục tiêu (ẩn danh, tối thiểu 10 người) */
  community: z.object({
    percentile: z.number().nullable(),
    cohort_size: z.number().int(),
    target_bucket: z.string().nullable(),
    reason: z.enum(['ok', 'no_estimate', 'cohort_too_small']),
  }),
  generated_at: z.string(),
  /** true khi trả từ cache Redis (≤ 1 giờ, xoá khi attempt.graded) */
  cached: z.boolean(),
});

// ----------------------------------------------------------------------------- Dự báo v0
export const forecastSchema = z.object({
  /** null khi chưa có điểm ước tính nào */
  predicted_score: z.number().nullable(),
  ci_low: z.number().nullable(),
  ci_high: z.number().nullable(),
  ready_date: isoDateSchema.nullable(),
  on_track: z.boolean().nullable(),
  /** Mã khuyến nghị – web dịch (`forecast.recommendation.<code>`) */
  recommendation_code: z.enum(['need_data', 'keep_going', 'increase_practice', 'on_track', 'target_reached', 'set_target']),
  recommendation: z.string(),
  computed_at: z.string(),
  /** v1.1 – S10 */
  status: z.enum(['ok', 'insufficient_data']),
  label: z.literal('preliminary_estimate'),
  model_version: z.string(),
  current_estimate: z.number().nullable(),
  target: z.number().nullable(),
  exam_date: isoDateSchema.nullable(),
  /** Ngày dự báo (ngày thi, hoặc +30 ngày khi chưa đặt ngày thi) */
  horizon_date: isoDateSchema,
  slope_per_week: z.number().nullable(),
  points_used: z.number().int(),
  scale: z.object({ min: z.number(), max: z.number() }),
});
export type Forecast = z.infer<typeof forecastSchema>;

// ----------------------------------------------------------------------------- Attribution & phễu
export const attributionInputSchema = z.object({
  utm_source: z.string().trim().max(100).optional(),
  utm_medium: z.string().trim().max(100).optional(),
  utm_campaign: z.string().trim().max(150).optional(),
  utm_term: z.string().trim().max(150).optional(),
  utm_content: z.string().trim().max(150).optional(),
  /** document.referrer – server chỉ lưu host */
  referrer: z.string().trim().max(2048).optional(),
  /** Đường dẫn trang đích (không lưu query string) */
  landing_path: z.string().trim().max(512).optional(),
  first_seen_at: z.iso.datetime({ offset: true }).optional(),
});
export type AttributionInput = z.infer<typeof attributionInputSchema>;

/** S12: + sự kiện beta (server, từ outbox): beta_redeemed, survey_submitted, feedback_submitted, content_reported, support_ticket_created */
export const FUNNEL_EVENTS = ['landing_view', 'signup_start', 'signup_done', 'diagnostic_done', 'first_attempt', 'checkout_start', 'order_paid', 'beta_redeemed', 'survey_submitted', 'feedback_submitted', 'content_reported', 'support_ticket_created'] as const;
export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];
/** Sự kiện client được phép gửi qua POST /analytics/events (còn lại do server phát từ outbox) */
export const CLIENT_FUNNEL_EVENTS = ['landing_view', 'signup_start', 'checkout_start'] as const;
export const funnelEventInputSchema = z.object({
  event: z.enum(CLIENT_FUNNEL_EVENTS),
  /** id ẩn danh của trình duyệt (PostHog distinct_id trước đăng nhập) */
  anonymous_id: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  /** Người dùng đã đồng ý cookie phân tích – false/thiếu → bỏ qua (202 accepted=false) */
  consent: z.boolean(),
  path: z.string().max(512).optional(),
  properties: z.record(z.string().max(40), z.union([z.string().max(200), z.number(), z.boolean()])).optional(),
});
export type FunnelEventInput = z.infer<typeof funnelEventInputSchema>;
export const funnelEventResultSchema = z.object({ accepted: z.boolean(), reason: z.enum(['ok', 'no_consent', 'disabled', 'rate_limited']) });
