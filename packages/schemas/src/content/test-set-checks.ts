import { IELTS_CBT, PROGRAM_REGISTRY, isProgramCode } from '../program/registry.js';
import type { SectionSpec, TestSetKind } from './test-set-structure.js';

/**
 * C3 – kiểm tra tự động cấp BỘ ĐỀ (bổ sung `validateTestSetStructure` – cấu trúc chung, và `runAutoChecks` – từng câu):
 * - `numbering_gap`: chương trình đếm theo mục (`marking = per_item`) đánh số "Questions 1–N" liên tục theo thứ tự đề trong từng kỹ
 *   năng (numberMarks); câu có số mục thiếu/0/không nguyên làm đứt dãy số.
 * - `ielts_mark_total`: đề IELTS full – mỗi kỹ năng Listening/Reading có mặt phải đúng 40 câu hỏi (mục).
 * - `ielts_section_marks`: đề IELTS full – từng part/passage đúng số mục chuẩn (catalog.sections.question_count: L 10×4, R 13/13/14).
 * - `listening_part_audio_missing`: part Listening không có audio (đề full: lỗi; đề khác: cảnh báo).
 * - `listening_part_multiple_audio`: part Listening IELTS có nhiều audio khác nhau – định dạng máy tính phát liên tục MỘT audio mỗi part
 *   (S170) – cảnh báo.
 * Trả mã + mức + tham số (thông điệp hiển thị theo mã – CMS tiếng Việt `describeTestSetCheck`, web qua i18n).
 */

export const TEST_SET_CHECK_CODES = ['numbering_gap', 'ielts_mark_total', 'ielts_section_marks', 'listening_part_audio_missing', 'listening_part_multiple_audio'] as const;
export type TestSetCheckCode = (typeof TEST_SET_CHECK_CODES)[number];

export interface TestSetCheckResult {
  code: TestSetCheckCode;
  level: 'error' | 'warning';
  params?: Record<string, string | number>;
}

export interface TestSetCheckItem {
  section_code: string;
  sort_order: number;
  /** Số mục đánh số của câu (markCount); thiếu → không xác định (đứt dãy số với chương trình per_item) */
  marks?: number | null;
  group_key?: string | null;
  /** Câu hoặc passage của câu có audio */
  has_audio?: boolean;
  /** Định danh audio (asset/media id) – phát hiện part có nhiều audio khác nhau */
  audio_key?: string | null;
  question_type?: string;
}

export interface TestSetCheckInput {
  program: string;
  kind: TestSetKind;
  sections: readonly SectionSpec[];
  items: readonly TestSetCheckItem[];
}

const LISTENING = 'listening';

export function runTestSetChecks(input: TestSetCheckInput): TestSetCheckResult[] {
  const out: TestSetCheckResult[] = [];
  const program = isProgramCode(input.program) ? PROGRAM_REGISTRY[input.program] : null;
  const perItem = program?.marking === 'per_item';
  const specByCode = new Map(input.sections.map((s) => [s.code, s]));
  const skillOf = (code: string) => specByCode.get(code)?.skill ?? program?.sections.find((s) => s.code === code)?.skill ?? null;
  const ordered = [...input.items].sort((a, b) => a.sort_order - b.sort_order);

  // Đánh số liên tục theo kỹ năng
  const marksBySkill = new Map<string, number>();
  const marksBySection = new Map<string, number>();
  for (const it of ordered) {
    const skill = skillOf(it.section_code) ?? it.section_code;
    const start = (marksBySkill.get(skill) ?? 0) + 1;
    const m = it.marks;
    const valid = typeof m === 'number' && Number.isInteger(m) && m >= 1;
    if (perItem && !valid) out.push({ code: 'numbering_gap', level: 'error', params: { section: it.section_code, sort_order: it.sort_order, number: start } });
    const w = valid ? m : perItem ? 0 : 1;
    marksBySkill.set(skill, start - 1 + w);
    marksBySection.set(it.section_code, (marksBySection.get(it.section_code) ?? 0) + w);
  }

  const isIelts = input.program === 'ielts';
  const full = input.kind === 'full';
  if (isIelts && full) {
    for (const skill of ['listening', 'reading'] as const) {
      if (!marksBySkill.has(skill)) continue;
      const actual = marksBySkill.get(skill)!;
      if (actual !== IELTS_CBT.total_marks) out.push({ code: 'ielts_mark_total', level: 'error', params: { skill, expected: IELTS_CBT.total_marks, actual } });
      const codes = skill === 'listening' ? IELTS_CBT.listening_sections : IELTS_CBT.reading_sections;
      for (const code of codes) {
        const expected = specByCode.get(code)?.question_count;
        if (expected == null) continue;
        const got = marksBySection.get(code) ?? 0;
        if (got !== expected) out.push({ code: 'ielts_section_marks', level: 'error', params: { section: code, expected, actual: got } });
      }
    }
  }

  // Audio từng part Listening (mọi chương trình có section Listening – IELTS: một audio liên tục mỗi part)
  const listeningSections = [...new Set(ordered.map((i) => i.section_code))].filter((c) => skillOf(c) === LISTENING);
  for (const code of listeningSections) {
    const items = ordered.filter((i) => i.section_code === code);
    if (!items.some((i) => i.has_audio)) out.push({ code: 'listening_part_audio_missing', level: full ? 'error' : 'warning', params: { section: code } });
    if (isIelts) {
      const keys = new Set(items.map((i) => i.audio_key).filter((k): k is string => !!k));
      if (keys.size > 1) out.push({ code: 'listening_part_multiple_audio', level: 'warning', params: { section: code, count: keys.size } });
    }
  }
  return out;
}
