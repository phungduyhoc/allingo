import { z } from 'zod';
import { localeSchema, programCodeSchema, uuidSchema } from '../common.js';

/**
 * Hợp đồng Sprint 6 (v1.1): tra từ & TTS, thẻ SRS từ vựng, ghi chú người học, tuỳ chọn thông báo + Web Push.
 * Bám docs/spec/allingo-openapi.yaml (DictionaryEntry, SrsCard, Note, NotificationPreferences, PushSubscription…).
 */

// ----------------------------------------------------------------------------- Tra từ
/**
 * Chuẩn hoá từ/cụm để tra (headword/form, khoá cache dịch): NFKC, chữ thường, nháy cong → thẳng, các loại gạch → '-',
 * gộp khoảng trắng, bỏ ký tự không phải chữ/số ở đầu/cuối (giữ `o'clock`, `e-mail`, `follow-up`).
 * Trùng khớp `normalizeTerm()` của dữ liệu từ điển (db/seed/dictionary/toeic-core-en-vi.ts) – test db kiểm chứng.
 */
export function normalizeLookupTerm(input: string): string {
  return input
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u02bc\u2032]/g, "'")
    .replace(/[\u2010-\u2015]/g, '-')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

/** Số từ của chuỗi đã chuẩn hoá (cụm ≥ 2 từ = "câu/cụm", tra AI cả cụm) */
export const lookupWordCount = (normalized: string): number => (normalized ? normalized.split(' ').length : 0);

export const DICTIONARY_QUERY_MAX = 500;
export const DICTIONARY_CONTEXT_MAX = 300;

/**
 * GET /dictionary/lookup – `q` (spec) hoặc bí danh `term` (S6); `program` mặc định toeic; `locale` mặc định explain_locale của người học.
 * `ai`: auto (mặc định: không có trong từ điển và không có gợi ý gần → dịch AI) | always (luôn dịch AI khi không có trong từ điển) | never.
 */
export const dictionaryLookupQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(DICTIONARY_QUERY_MAX).optional(),
    term: z.string().trim().min(1).max(DICTIONARY_QUERY_MAX).optional(),
    program: programCodeSchema.default('toeic'),
    context: z.string().trim().max(DICTIONARY_CONTEXT_MAX).optional(),
    locale: localeSchema.optional(),
    ai: z.enum(['auto', 'always', 'never']).default('auto'),
  })
  .refine((v) => !!(v.q ?? v.term), { message: 'q (or term) is required', path: ['q'] });
export type DictionaryLookupQuery = z.infer<typeof dictionaryLookupQuerySchema>;

export const dictionaryMeaningSchema = z.object({ en: z.string().nullable(), local: z.string().nullable(), pos: z.string().nullable().optional() });
export const dictionaryExampleSchema = z.object({ text: z.string(), translation: z.string().nullable() });

export const DICTIONARY_SOURCES = ['dictionary', 'ai', 'none'] as const;
export const DICTIONARY_MATCHES = ['headword', 'form', 'none'] as const;

export const dictionaryEntrySchema = z.object({
  /** Chuỗi người học tra (đã cắt khoảng trắng) */
  query: z.string(),
  /** Headword khớp (từ điển) hoặc chính chuỗi tra (AI/none) */
  headword: z.string(),
  pos: z.string().nullable(),
  /** IPA ưu tiên giọng Mỹ (tương thích spec) */
  ipa: z.string().nullable(),
  ipa_us: z.string().nullable(),
  ipa_uk: z.string().nullable(),
  /** URL ký (10 phút) của audio TTS đã cache; null khi chưa sinh → gọi GET /tts?text=<headword> (server đã bắt đầu sinh nền) */
  audio_url: z.string().nullable(),
  audio_expires_at: z.string().nullable(),
  meaning_en: z.string().nullable(),
  /** Nghĩa theo `locale` (fallback vi → en) */
  meaning_local: z.string().nullable(),
  example: z.string().nullable(),
  meanings: z.array(dictionaryMeaningSchema),
  examples: z.array(dictionaryExampleSchema),
  collocations: z.array(z.string()),
  forms: z.array(z.string()),
  level: z.string().nullable(),
  topics: z.array(z.string()),
  vocab_item_id: uuidSchema.nullable(),
  /** Đã có thẻ SRS (learn.srs_cards kind vocab) cho mục này */
  saved: z.boolean(),
  srs_card_id: uuidSchema.nullable(),
  source: z.enum(DICTIONARY_SOURCES),
  matched: z.enum(DICTIONARY_MATCHES),
  /** Kết quả dịch AI (segment_translate) khi không có trong từ điển */
  translation: z.object({ text: z.string(), needs_review: z.boolean(), ai_task_id: uuidSchema.nullable() }).nullable(),
  /** true khi bản dịch lấy từ ai.translation_cache (không gọi model, không tính quota) */
  cached: z.boolean(),
  /** Gợi ý pg_trgm khi gõ sai / không khớp (≤ 5) */
  suggestions: z.array(z.object({ headword: z.string(), similarity: z.number() })),
  locale: z.string(),
  /** Ghi nguồn dữ liệu từ điển (giấy phép) – hiển thị nhỏ dưới popover */
  attribution: z.string().nullable(),
});
export type DictionaryEntry = z.infer<typeof dictionaryEntrySchema>;

/** GET /tts – văn bản ≤ 500 ký tự; voice mặc định en-US */
export const ttsQuerySchema = z.object({ text: z.string().trim().min(1).max(500), voice: z.string().max(64).optional() });
export const ttsResultSchema = z.object({ url: z.string(), duration_ms: z.number().int(), expires_at: z.string().nullable(), cached: z.boolean(), voice: z.string() });
export type TtsResult = z.infer<typeof ttsResultSchema>;

// ----------------------------------------------------------------------------- SRS (thẻ ôn tập – FSRS-5 từ S10)
export const SRS_CARD_TYPES = ['vocab', 'error', 'grammar', 'phoneme', 'sentence'] as const;
/** S10: loại thẻ tạo được qua POST /me/srs/cards (phoneme/sentence – GĐ2 shadowing) */
export const SRS_CREATABLE_CARD_TYPES = ['vocab', 'error', 'grammar'] as const;
export const SRS_STATES = ['new', 'learning', 'review', 'relearning'] as const;
export const srsCardCreateSchema = z
  .object({
    program: programCodeSchema,
    card_type: z.enum(SRS_CARD_TYPES),
    /** vocab: vocab_item_id · error: error_log_entry_id · grammar: grammar_topic_id */
    ref_id: uuidSchema.optional(),
    /** Chỉ vocab: tra từ điển theo headword (không có → mục draft từ bản dịch AI đã cache) */
    headword: z.string().trim().min(1).max(100).optional(),
    /** passage | dictionary | review | manual | feedback | lesson | error_log | vocab_list */
    source_type: z.string().max(32).optional(),
    source_id: uuidSchema.optional(),
    /** Câu chứa từ (lưu vào payload để ôn theo ngữ cảnh), ≤ 300 ký tự */
    context: z.string().trim().max(300).optional(),
  })
  .refine((v) => !!(v.ref_id ?? v.headword), { message: 'ref_id or headword is required', path: ['ref_id'] })
  .refine((v) => v.card_type === 'vocab' || !!v.ref_id, { message: 'ref_id is required for this card_type', path: ['ref_id'] });
export type SrsCardCreate = z.infer<typeof srsCardCreateSchema>;

/** Ngày đến hạn xem trước cho 4 nút (Again/Hard/Good/Easy) – S10 */
export const srsPreviewSchema = z.object({ again: z.string(), hard: z.string(), good: z.string(), easy: z.string() });

export const srsCardSchema = z.object({
  id: uuidSchema,
  card_type: z.string(),
  ref_id: uuidSchema,
  state: z.enum(SRS_STATES),
  due_at: z.string(),
  stability: z.number().nullable(),
  difficulty: z.number().nullable(),
  reps: z.number().int(),
  lapses: z.number().int(),
  payload: z.record(z.string(), z.unknown()),
  /** v1.1 – S6: false khi thẻ đã tồn tại (POST idempotent theo user × card_type × ref_id) */
  created: z.boolean().optional(),
  /** v1.1 – S10 */
  last_review_at: z.string().nullable().optional(),
  source_type: z.string().nullable().optional(),
  suspended: z.boolean().optional(),
  /** stability ≥ 21 ngày ở trạng thái review */
  mastered: z.boolean().optional(),
  /** Lịch nếu chọn từng nút (GET /me/srs/due) */
  preview: srsPreviewSchema.optional(),
  /** POST /me/srs/review: review trùng (card_id, reviewed_at) đã ghi trước đó – không đổi lịch */
  duplicate: z.boolean().optional(),
  /** POST /me/srs/review: thẻ đến hạn lại trong ≤ 20 phút (Again/Hard) → quay lại trong phiên */
  in_session: z.boolean().optional(),
});
export type SrsCard = z.infer<typeof srsCardSchema>;

// ----------------------------------------------------------------------------- Ghi chú
export const NOTE_BODY_MAX = 2000;

/** Giải mã thực thể HTML (số thập phân/hex + một số tên) – chỉ để KIỂM TRA scheme URL, không thay nội dung */
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);?/gi, (_m, h: string) => String.fromCodePoint(Math.min(parseInt(h, 16), 0x10ffff)))
    .replace(/&#(\d+);?/g, (_m, d: string) => String.fromCodePoint(Math.min(parseInt(d, 10), 0x10ffff)))
    .replace(/&(colon|tab|newline|lpar|rpar|sol|period);/gi, (_m, n: string) => ({ colon: ':', tab: '\t', newline: '\n', lpar: '(', rpar: ')', sol: '/', period: '.' })[n.toLowerCase()] ?? '');
}

const DANGEROUS_SCHEME = /^(?:javascript|vbscript|data|file|livescript|mocha):/;

/**
 * S11 (pentest 1 – XSS): đích liên kết nguy hiểm sau khi chuẩn hoá như trình duyệt (giải mã thực thể, percent-decode,
 * bỏ khoảng trắng/ký tự điều khiển – trình duyệt bỏ TAB/LF trong scheme) → true.
 */
export function isDangerousLinkTarget(dest: string): boolean {
  let d = decodeEntities(dest);
  try {
    d = decodeURIComponent(d);
  } catch {
    /* giữ nguyên khi percent-encoding hỏng */
  }
  // eslint-disable-next-line no-control-regex -- loại ký tự điều khiển + khoảng trắng như bộ phân tích URL của trình duyệt
  d = d.replace(/[\u0000-\u0020\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/g, '').toLowerCase();
  return DANGEROUS_SCHEME.test(d);
}

/**
 * Làm sạch Markdown ngắn của ghi chú: bỏ thẻ/comment HTML (lặp tới khi ổn định – chặn thẻ lồng `<scr<script>ipt>`),
 * vô hiệu liên kết javascript:/data:/vbscript: kể cả dạng mã hoá thực thể/percent/ký tự điều khiển (liên kết inline, định nghĩa
 * tham chiếu `[x]: url`), bỏ ký tự điều khiển, chuẩn hoá xuống dòng (tối đa 2 dòng trống). Không render HTML – client hiển thị
 * Markdown an toàn (defense in depth: web dùng renderer không innerHTML).
 */
export function sanitizeNoteMarkdown(input: string): string {
  let s = input.replace(/\r\n?/g, '\n');
  for (let i = 0; i < 10; i++) {
    const next = s.replace(/<!--[\s\S]*?(-->|$)/g, '').replace(/<\/?[a-zA-Z!?][^<>]*>/g, '');
    if (next === s) break;
    s = next;
  }
  // Còn sót "<tag" chưa đóng (vd cắt giữa chừng) → bỏ dấu "<" trước chữ cái/"/"/"!" để không thành thẻ khi ghép chuỗi
  s = s.replace(/<(?=[a-zA-Z/!?])/g, '');
  // Liên kết inline [text](dest "title") – kiểm đích sau chuẩn hoá
  s = s.replace(/\]\(\s*((?:[^()\s]|\([^()]*\))*)([^)]*)\)/g, (m: string, dest: string) => (isDangerousLinkTarget(dest) ? ']()' : m));
  // Định nghĩa tham chiếu [label]: dest
  s = s.replace(/^(\s{0,3}\[[^\]\n]+\]:)[ \t]*(\S+)(.*)$/gm, (m: string, label: string, dest: string) => (isDangerousLinkTarget(dest) ? `${label} #` : m));
  return (
    s
      .replace(/(?:javascript|vbscript):/gi, '')
      // eslint-disable-next-line no-control-regex -- loại ký tự điều khiển (trừ \n, \t)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

export const noteCreateSchema = z
  .object({
    body: z.string().max(NOTE_BODY_MAX * 2),
    question_version_id: uuidSchema.optional(),
    attempt_id: uuidSchema.optional(),
    question_id: uuidSchema.optional(),
    test_set_id: uuidSchema.optional(),
  });
export type NoteCreate = z.infer<typeof noteCreateSchema>;
export const noteUpdateSchema = z.object({ body: z.string().max(NOTE_BODY_MAX * 2) });
/** PUT /notes (spec v1.0, tương thích): ghi đè ghi chú mới nhất theo câu (question_id) hoặc đề (test_set_id) */
export const notePutSchema = z.object({ body: z.string().max(NOTE_BODY_MAX * 2), test_set_id: uuidSchema.optional(), question_id: uuidSchema.optional(), question_version_id: uuidSchema.optional(), attempt_id: uuidSchema.optional() });
export const notesListQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  question_version_id: uuidSchema.optional(),
  question_id: uuidSchema.optional(),
  attempt_id: uuidSchema.optional(),
  test_set_id: uuidSchema.optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export const noteSchema = z.object({
  id: uuidSchema,
  body: z.string(),
  question_id: uuidSchema.nullable(),
  question_version_id: uuidSchema.nullable(),
  attempt_id: uuidSchema.nullable(),
  test_set_id: uuidSchema.nullable(),
  created_at: z.string().nullable(),
  updated_at: z.string(),
});
export type Note = z.infer<typeof noteSchema>;

// ----------------------------------------------------------------------------- Thông báo & Web Push
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');
export const NOTIFICATION_CHANNELS = ['email', 'push', 'zalo', 'sms', 'inapp'] as const;
/** Loại thông báo người dùng tự bật/tắt (v1.1 – S8); `system` (cảnh báo vận hành) không cấu hình được */
export const NOTIFICATION_CATEGORIES = ['learning', 'billing', 'marketing'] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];
/** Kênh giao thông báo của NotificationService (zalo/sms: GĐ4) */
export const DELIVERY_CHANNELS = ['email', 'push', 'inapp'] as const;
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];
export const categoryChannelsSchema = z.object({ email: z.boolean(), push: z.boolean(), inapp: z.boolean() });
export const notificationCategoriesSchema = z.object({ learning: categoryChannelsSchema, billing: categoryChannelsSchema, marketing: categoryChannelsSchema });
export type NotificationCategories = z.infer<typeof notificationCategoriesSchema>;
/** Giới hạn tần suất (không cấu hình bởi người dùng): ≤ 1 email marketing / 7 ngày, ≤ 2 push không giao dịch / ngày (giờ VN) */
export const NOTIFICATION_FREQUENCY = { marketing_email_per_week: 1, push_per_day: 2 } as const;

export const notificationPreferencesSchema = z.object({
  channels: z.partialRecord(z.enum(NOTIFICATION_CHANNELS), z.boolean()),
  quiet_hours: z.object({ start: hhmm, end: hhmm }),
  reminder_times: z.array(hhmm).max(5),
  /** v1.1 – S6 */
  updated_at: z.string().optional(),
  /** v1.1 – S6: số thiết bị đã đăng ký Web Push */
  push_subscriptions: z.number().int().optional(),
  /** v1.1 – S8: bật/tắt theo loại × kênh; kênh tắt ở `channels` thắng. Email giao dịch (biên lai, hoá đơn) luôn gửi */
  categories: notificationCategoriesSchema.optional(),
  /** v1.1 – S8: giới hạn tần suất áp dụng (chỉ đọc) */
  frequency: z.object({ marketing_email_per_week: z.number().int(), push_per_day: z.number().int() }).optional(),
  /** v1.1 – S8: múi giờ của giờ yên lặng (chỉ đọc – luôn Asia/Ho_Chi_Minh) */
  timezone: z.string().optional(),
});
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;
export const notificationPreferencesPatchSchema = z.object({
  channels: z.partialRecord(z.enum(NOTIFICATION_CHANNELS), z.boolean()).optional(),
  quiet_hours: z.object({ start: hhmm, end: hhmm }).optional(),
  reminder_times: z.array(hhmm).max(5).optional(),
  /** v1.1 – S8: cập nhật một phần theo loại/kênh */
  categories: z.object({ learning: categoryChannelsSchema.partial(), billing: categoryChannelsSchema.partial(), marketing: categoryChannelsSchema.partial() }).partial().optional(),
});
export type NotificationPreferencesPatch = z.infer<typeof notificationPreferencesPatchSchema>;

const base64url = z.string().regex(/^[A-Za-z0-9_-]+=*$/, 'base64url');
/** Body `PushSubscription.toJSON()` của trình duyệt (+ user_agent/locale tuỳ chọn) */
export const pushSubscriptionInputSchema = z.object({
  endpoint: z.url({ protocol: /^https$/ }).max(2048),
  expirationTime: z.number().int().nullable().optional(),
  keys: z.object({ p256dh: base64url.min(80).max(120), auth: base64url.min(16).max(40) }),
  user_agent: z.string().max(300).optional(),
  locale: localeSchema.optional(),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionInputSchema>;
export const pushSubscriptionSchema = z.object({
  id: uuidSchema,
  /** Chỉ origin của endpoint (không lộ token thiết bị) */
  endpoint_origin: z.string(),
  user_agent: z.string().nullable(),
  locale: z.string().nullable(),
  created_at: z.string(),
  last_success_at: z.string().nullable(),
  expires_at: z.string().nullable(),
  /** POST: false khi endpoint đã đăng ký (cập nhật khoá) */
  created: z.boolean().optional(),
});
export type PushSubscriptionView = z.infer<typeof pushSubscriptionSchema>;
export const vapidPublicKeySchema = z.object({ public_key: z.string().nullable(), enabled: z.boolean() });

/** Mẫu thông báo đẩy – web/service worker dịch theo i18n `push.<template_code>.title|body` khi title/body = null */
export const PUSH_TEMPLATES = ['study_reminder', 'test'] as const;
export const pushPayloadSchema = z.object({
  v: z.literal(1),
  notification_id: uuidSchema,
  /** S6: study_reminder | test; v1.1 – S8: mọi mã template của NotificationService (title/body đã dựng sẵn) */
  template_code: z.string(),
  title: z.string().nullable(),
  body: z.string().nullable(),
  /** Đường dẫn tương đối trong web (mở khi bấm) */
  url: z.string(),
  tag: z.string(),
  locale: z.string(),
  sent_at: z.string(),
});
export type PushPayload = z.infer<typeof pushPayloadSchema>;

export const adminTestNotificationInputSchema = z.object({
  /** Mặc định: chính admin gọi */
  user_id: uuidSchema.optional(),
  template_code: z.enum(PUSH_TEMPLATES).default('study_reminder'),
  title: z.string().trim().min(1).max(80).optional(),
  body: z.string().trim().min(1).max(200).optional(),
  url: z.string().regex(/^\/(?!\/)[\w\-./?=&%#]*$/, 'relative path').max(200).default('/'),
  /** Bỏ qua tuỳ chọn channels.push = false của người nhận */
  force: z.boolean().default(false),
});
export type AdminTestNotificationInput = z.infer<typeof adminTestNotificationInputSchema>;
export const adminTestNotificationResultSchema = z.object({
  notification_id: uuidSchema.nullable(),
  user_id: uuidSchema,
  status: z.enum(['sent', 'failed', 'skipped']),
  reason: z.string().nullable(),
  sent: z.number().int(),
  failed: z.number().int(),
  removed: z.number().int(),
  results: z.array(z.object({ subscription_id: uuidSchema, ok: z.boolean(), status_code: z.number().int().nullable(), removed: z.boolean() })),
});
export type AdminTestNotificationResult = z.infer<typeof adminTestNotificationResultSchema>;
