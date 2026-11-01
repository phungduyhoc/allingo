import { PROGRAM_CODES, QUESTION_TYPE_CODES, pickLocalized, type LocalizedText, type ProgramCode, type QuestionTypeCode } from '@allingo/schemas';

/**
 * Danh mục tham chiếu tĩnh (fallback khi API nội bộ `GET /internal/content/reference` chưa chạy).
 * Nguồn sự thật là catalog.programs/sections/topics/subskills/question_types (seed core của db).
 */

export interface ReferenceData {
  programs: Array<{ code: string; name: string }>;
  sections: Array<{ program: string; code: string; name: string; level: string | null }>;
  topics: Array<{ code: string; name: string }>;
  subskills: Array<{ program: string; code: string; name: string }>;
  question_types: Array<{ code: string; name: string }>;
}

/** Dạng thô từ API: `name` có thể là chuỗi hoặc LocalizedText {vi,en,...} */
type RawName = string | LocalizedText | null | undefined;
export interface RawReferenceData {
  programs?: Array<{ code: string; name?: RawName }>;
  sections?: Array<{ program: string; code: string; name?: RawName; level?: string | number | null }>;
  topics?: Array<{ code: string; name?: RawName }>;
  subskills?: Array<{ program: string; code: string; name?: RawName }>;
  question_types?: Array<{ code: string; name?: RawName }>;
}

function nameOf(n: RawName, fallback: string, locale = 'vi'): string {
  if (typeof n === 'string') return n || fallback;
  if (n && typeof n === 'object') return pickLocalized(n, locale) || fallback;
  return fallback;
}

/** Chuẩn hoá dữ liệu tham chiếu từ API nội bộ về dạng phẳng (name: string) dùng cho dropdown */
export function normalizeReference(raw: RawReferenceData, locale = 'vi'): ReferenceData {
  return {
    programs: (raw.programs ?? []).map((p) => ({ code: p.code, name: nameOf(p.name, p.code.toUpperCase(), locale) })),
    sections: (raw.sections ?? []).map((s) => ({ program: s.program, code: s.code, name: nameOf(s.name, s.code, locale), level: s.level === undefined || s.level === null ? null : String(s.level) })),
    topics: (raw.topics ?? []).map((t) => ({ code: t.code, name: nameOf(t.name, t.code, locale) })),
    subskills: (raw.subskills ?? []).map((s) => ({ program: s.program, code: s.code, name: nameOf(s.name, s.code, locale) })),
    question_types: (raw.question_types ?? []).map((q) => ({ code: q.code, name: nameOf(q.name, q.code, locale) })),
  };
}

export const PROGRAM_OPTIONS: ReadonlyArray<{ value: ProgramCode; label: string }> = [
  { value: 'toeic', label: 'TOEIC' },
  { value: 'ielts', label: 'IELTS' },
  { value: 'jlpt', label: 'JLPT' },
  { value: 'hsk', label: 'HSK' },
];

export const QUESTION_TYPE_LABELS: Record<QuestionTypeCode, { vi: string; en: string }> = {
  mcq_single: { vi: 'Trắc nghiệm 1 đáp án', en: 'Multiple choice (single)' },
  mcq_multi: { vi: 'Trắc nghiệm nhiều đáp án', en: 'Multiple choice (multi)' },
  fill_blank: { vi: 'Điền vào chỗ trống', en: 'Fill in the blank' },
  matching: { vi: 'Nối cặp', en: 'Matching' },
  drag_drop: { vi: 'Kéo thả', en: 'Drag & drop' },
  map_label: { vi: 'Gắn nhãn bản đồ/sơ đồ', en: 'Map labelling' },
  tfng: { vi: 'True/False/Not Given', en: 'True/False/Not Given' },
  ordering: { vi: 'Sắp xếp thứ tự', en: 'Ordering' },
  dictation: { vi: 'Nghe chép chính tả', en: 'Dictation' },
  essay: { vi: 'Viết luận', en: 'Essay' },
  speaking: { vi: 'Nói', en: 'Speaking' },
  handwriting: { vi: 'Viết chữ Hán/Kanji', en: 'Handwriting' },
};

export const QUESTION_TYPE_OPTIONS = QUESTION_TYPE_CODES.map((code) => ({
  value: code,
  label: { vi: `${QUESTION_TYPE_LABELS[code].vi} (${code})`, en: `${QUESTION_TYPE_LABELS[code].en} (${code})` },
}));

/** catalog.difficulty */
export const DIFFICULTY_CODES = [
  'A1',
  'A2',
  'B1',
  'B2',
  'C1',
  'C2',
  'N5',
  'N4',
  'N3',
  'N2',
  'N1',
  'HSK1',
  'HSK2',
  'HSK3',
  'HSK4',
  'HSK5',
  'HSK6',
  'HSK7_9',
  'mixed',
] as const;
export type DifficultyCode = (typeof DIFFICULTY_CODES)[number];

/** TOEIC Listening & Reading: 7 part, số câu chuẩn của đề full */
export const TOEIC_SECTIONS: ReadonlyArray<{ code: string; name: string; count: number; level: 'listening' | 'reading' }> = [
  { code: 'part1', name: 'Part 1 – Photographs', count: 6, level: 'listening' },
  { code: 'part2', name: 'Part 2 – Question-Response', count: 25, level: 'listening' },
  { code: 'part3', name: 'Part 3 – Conversations', count: 39, level: 'listening' },
  { code: 'part4', name: 'Part 4 – Talks', count: 30, level: 'listening' },
  { code: 'part5', name: 'Part 5 – Incomplete Sentences', count: 30, level: 'reading' },
  { code: 'part6', name: 'Part 6 – Text Completion', count: 16, level: 'reading' },
  { code: 'part7', name: 'Part 7 – Reading Comprehension', count: 54, level: 'reading' },
];

export const TOEIC_FULL_COUNTS: Readonly<Record<string, number>> = Object.fromEntries(TOEIC_SECTIONS.map((s) => [s.code, s.count]));

const IELTS_SECTIONS = ['listening', 'reading', 'writing', 'speaking'].map((code) => ({
  program: 'ielts',
  code,
  name: code.charAt(0).toUpperCase() + code.slice(1),
  level: null,
}));
const JLPT_SECTIONS = ['vocabulary', 'grammar', 'reading', 'listening'].map((code) => ({
  program: 'jlpt',
  code,
  name: code.charAt(0).toUpperCase() + code.slice(1),
  level: null,
}));
const HSK_SECTIONS = ['listening', 'reading', 'writing'].map((code) => ({
  program: 'hsk',
  code,
  name: code.charAt(0).toUpperCase() + code.slice(1),
  level: null,
}));

/** Fallback tĩnh khi API nội bộ chưa sẵn sàng */
export const STATIC_REFERENCE: ReferenceData = {
  programs: PROGRAM_CODES.map((code) => ({ code, name: code.toUpperCase() })),
  sections: [
    ...TOEIC_SECTIONS.map((s) => ({ program: 'toeic', code: s.code, name: s.name, level: s.level })),
    ...IELTS_SECTIONS,
    ...JLPT_SECTIONS,
    ...HSK_SECTIONS,
  ],
  topics: [],
  subskills: [],
  question_types: QUESTION_TYPE_CODES.map((code) => ({ code, name: QUESTION_TYPE_LABELS[code].en })),
};
