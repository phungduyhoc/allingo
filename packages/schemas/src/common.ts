import { z } from 'zod';

/** Ngôn ngữ giao diện/giải thích được hỗ trợ (CLAUDE.md §5.11) */
export const LOCALES = ['vi', 'en', 'ja', 'ko', 'th'] as const;
export type Locale = (typeof LOCALES)[number];
export const localeSchema = z.enum(LOCALES);

/** Văn bản đa ngôn ngữ dạng JSONB { vi, en, ja, ko, th } – fallback en rồi vi */
export const localizedTextSchema = z
  .object({ vi: z.string().optional(), en: z.string().optional(), ja: z.string().optional(), ko: z.string().optional(), th: z.string().optional() })
  .catchall(z.string());
export type LocalizedText = z.infer<typeof localizedTextSchema>;

/** Lấy chuỗi theo locale với fallback en → vi → bất kỳ */
export function pickLocalized(text: LocalizedText | null | undefined, locale: string): string {
  if (!text) return '';
  const t = text as Record<string, string | undefined>;
  return t[locale] ?? t.en ?? t.vi ?? Object.values(t).find((v): v is string => typeof v === 'string' && v.length > 0) ?? '';
}

export const PROGRAM_CODES = ['toeic', 'ielts', 'jlpt', 'hsk'] as const;
export type ProgramCode = (typeof PROGRAM_CODES)[number];
export const programCodeSchema = z.enum(PROGRAM_CODES);

export const uuidSchema = z.uuid();
export const isoDateTimeSchema = z.iso.datetime({ offset: true });
export const isoDateSchema = z.iso.date();

/** Phân trang cursor { data, next_cursor } (CLAUDE.md §6) */
export const cursorQuerySchema = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type CursorQuery = z.infer<typeof cursorQuerySchema>;

export function pageSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({ data: z.array(item), next_cursor: z.string().nullable() });
}

/** Envelope lỗi API: { error: { code, message, details, trace_id } } */
export const ERROR_CODES = [
  'validation_failed',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'quota_exceeded',
  'insufficient_credits',
  'payment_failed',
  'rate_limited',
  'exam_mode_locked',
  'feature_disabled',
  'internal',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
    trace_id: z.string().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
