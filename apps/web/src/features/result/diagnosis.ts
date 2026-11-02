import { z } from 'zod';
import type { AttemptResult } from '@/lib/types';

/**
 * Đọc an toàn `AttemptResult.diagnosis` (JSONB, kiểu `AttemptDiagnosis` của packages/scoring – chẩn đoán theo quy tắc S3)
 * và `scale` (thang quy đổi ước tính). Dữ liệu sai dạng → null, màn kết quả vẫn hiển thị phần còn lại.
 */

const weakAreaSchema = z.object({ code: z.string(), correct: z.number(), total: z.number(), accuracy: z.number() });

export const diagnosisSchema = z.object({
  method: z.string(),
  overall_accuracy: z.number(),
  weak_sections: z.array(weakAreaSchema).default([]),
  weak_subskills: z.array(weakAreaSchema).default([]),
  weak_topics: z.array(weakAreaSchema).default([]),
  timeout_wrong: z.number().default(0),
  unanswered: z.number().default(0),
  slow_wrong_question_ids: z.array(z.string()).default([]),
  // Cờ lạ (bản API mới hơn) bị bỏ qua thay vì làm hỏng cả khối
  flags: z.array(z.string()).default([]),
  recommendations: z
    .array(z.object({ kind: z.string(), section_code: z.string(), subskill_code: z.string().optional(), topic_code: z.string().optional() }))
    .default([]),
});
export type Diagnosis = z.infer<typeof diagnosisSchema>;
export type WeakArea = z.infer<typeof weakAreaSchema>;

export const KNOWN_FLAGS = ['many_unanswered', 'time_pressure', 'slow_reading', 'strong_performance'] as const;
export type DiagnosisFlag = (typeof KNOWN_FLAGS)[number];

export function parseDiagnosis(raw: unknown): Diagnosis | null {
  const r = diagnosisSchema.safeParse(raw);
  return r.success ? r.data : null;
}

export function knownFlags(d: Diagnosis): DiagnosisFlag[] {
  return d.flags.filter((f): f is DiagnosisFlag => (KNOWN_FLAGS as readonly string[]).includes(f));
}

export const toPercent = (accuracy: number): number => Math.round(Math.max(0, Math.min(1, accuracy)) * 100);

/** Link luyện tập từ gợi ý: /toeic/practice?section=part5&subskill=… (trang practice đọc query để chọn sẵn) */
export function recommendationHref(rec: Diagnosis['recommendations'][number], program = 'toeic'): string {
  const qs = new URLSearchParams({ section: rec.section_code });
  if (rec.subskill_code) qs.set('subskill', rec.subskill_code);
  if (rec.topic_code) qs.set('topic', rec.topic_code);
  return `/${program}/practice?${qs.toString()}`;
}

export interface ScaleView {
  kind: 'total' | 'skill';
  skill?: 'listening' | 'reading';
  min: number;
  max: number;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Thang hiển thị cạnh điểm ước tính TOEIC: đủ hai kỹ năng → 10–990; một kỹ năng → 5–495 (Reading hoặc Listening).
 * Hỗ trợ cả `scale.{listening,reading,total}` (API) và `scale.skills.{…}` (bản mock cũ).
 */
export function scaleView(result: Pick<AttemptResult, 'scale' | 'by_section'>): ScaleView | null {
  const s = result.scale ?? {};
  if (s.program !== undefined && s.program !== 'toeic') return null;
  const skills = (typeof s.skills === 'object' && s.skills ? s.skills : s) as Record<string, unknown>;
  const listening = num(skills.listening);
  const reading = num(skills.reading);
  const total = num(s.total);
  if (total !== null || (listening !== null && reading !== null)) return { kind: 'total', min: 10, max: 990 };
  if (reading !== null) return { kind: 'skill', skill: 'reading', min: 5, max: 495 };
  if (listening !== null) return { kind: 'skill', skill: 'listening', min: 5, max: 495 };
  // Không có thông tin kỹ năng → suy từ Part có trong bài
  const parts = Object.keys(result.by_section ?? {});
  const hasL = parts.some((p) => ['part1', 'part2', 'part3', 'part4'].includes(p));
  const hasR = parts.some((p) => ['part5', 'part6', 'part7'].includes(p));
  if (hasL && hasR) return { kind: 'total', min: 10, max: 990 };
  if (hasR || hasL) return { kind: 'skill', skill: hasR ? 'reading' : 'listening', min: 5, max: 495 };
  return null;
}

/**
 * Câu tự kiểm tra của chẩn đoán AI: vị trí đáp án đúng trong `options`. `answer` có thể là nguyên văn lựa chọn
 * (không phân biệt hoa thường/khoảng trắng) hoặc chữ cái "B" / "B." / "B)"; không khớp → -1.
 */
export function checkAnswerIndex(options: readonly string[], answer: string): number {
  const a = answer.trim().toLowerCase();
  const byText = options.findIndex((o) => o.trim().toLowerCase() === a);
  if (byText >= 0) return byText;
  const m = /^([a-f])[.)]?$/.exec(a);
  if (!m) return -1;
  const idx = m[1]!.charCodeAt(0) - 97;
  return idx < options.length ? idx : -1;
}
