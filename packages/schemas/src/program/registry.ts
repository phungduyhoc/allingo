import { PROGRAM_CODES, type ProgramCode } from '../common.js';
import type { QuestionTypeCode } from '../question/content.js';

/**
 * C1 – registry cấu hình chương trình (ADR-0038): nguồn duy nhất cho logic dùng chung (test engine, xem lại, sổ lỗi, thống kê,
 * planner, chẩn đoán, web) thay cho các phép so sánh cứng `program === 'toeic'`. Bản sao tĩnh, khớp seed `catalog.programs/
 * skills/sections` (db/seed/core/catalog.ts) – test `program-registry.test.ts` kiểm tra hai phía không lệch. Nhãn hiển thị lấy qua
 * i18n theo mã (`programs.*`, `sections.*` ở packages/i18n) – registry chỉ giữ mã, không giữ chuỗi giao diện.
 */

/** Thang điểm của chương trình (mọi quy đổi là ƯỚC TÍNH của Allingo – xem @allingo/scoring) */
export interface ProgramScaleDef {
  /** toeic_lr: 5–495 mỗi kỹ năng, tổng 10–990; band: IELTS 0–9 bước 0,5; points: JLPT/HSK (GĐ3 – chỉ khai báo) */
  kind: 'toeic_lr' | 'band' | 'points';
  unit: 'points' | 'band';
  min: number;
  max: number;
  step: number;
  /** Biên một kỹ năng (TOEIC 5–495) – null khi thang theo kỹ năng giống thang tổng (IELTS) */
  skill_min: number | null;
  skill_max: number | null;
  /** true: cơ chế quy đổi đã có trong @allingo/scoring; false: chỉ khai báo (giao diện hiện "chưa có thang quy đổi") */
  implemented: boolean;
}

export interface ProgramSectionDef {
  code: string;
  skill: string;
  /** Phần thi tự chấm (Listening/Reading) – dùng cho luyện tập theo Part, sổ lỗi, chẩn đoán */
  auto: boolean;
}

export interface ProgramTargetDef {
  /** score: mục tiêu là điểm số (TOEIC/IELTS); level: cấp độ (JLPT N5–N1, HSK 1–9) */
  kind: 'score' | 'level';
  min: number;
  max: number;
  step: number;
  default: number;
  levels: readonly string[];
}

export interface ProgramDef {
  code: ProgramCode;
  /** Giai đoạn roadmap: GĐ1 TOEIC L&R, GĐ2 IELTS, GĐ3 JLPT/HSK */
  phase: 1 | 2 | 3;
  /**
   * Cờ ra mắt chương trình (`ff.catalog.program.<code>` – PUBLIC_FLAG_KEYS). null = luôn mở (TOEIC). Chương trình "có thể học"
   * khi cờ bật VÀ có ít nhất một đề đã phát hành; còn lại hiển thị "sắp ra mắt" + danh sách chờ (A242).
   */
  launch_flag: string | null;
  /** Ngôn ngữ mục tiêu (BCP-47) – khớp catalog.programs.languages */
  target_language: 'en' | 'ja' | 'zh';
  skills: readonly string[];
  sections: readonly ProgramSectionDef[];
  scale: ProgramScaleDef;
  target: ProgramTargetDef;
  /**
   * Phần thi mà đề/lựa chọn được ĐỌC trong audio (không in trên đề) – ẩn chữ khi đang làm bài (thay SPOKEN_TEXT_SECTIONS cứng):
   * TOEIC Part 1/2.
   */
  spoken_sections: readonly string[];
  /**
   * Cách đếm điểm thô: per_question – mỗi câu catalog 1 điểm (TOEIC); per_item – mỗi mục đánh số trong câu (IELTS: câu TFNG 5
   * mệnh đề = 5 câu hỏi) – xem `markCount()` ở question/marks.ts.
   */
  marking: 'per_question' | 'per_item';
  /** Dạng câu hỗ trợ trong chương trình (soạn nội dung, lọc luyện tập, CMS) */
  question_types: readonly QuestionTypeCode[];
  /** Phần thi chẩn đoán thích ứng có blueprint riêng (TOEIC); còn lại dùng blueprint chung theo ngân hàng */
  diagnostic: 'toeic_lr' | 'generic';
}

/** Dạng câu IELTS Reading/Listening (C2) – kèm các dạng chung đã có (mcq_single/mcq_multi/tfng) */
export const IELTS_RL_QUESTION_TYPES = [
  'mcq_single',
  'mcq_multi',
  'tfng',
  'matching_headings',
  'matching_information',
  'matching_features',
  'matching_sentence_endings',
  'sentence_completion',
  'summary_completion',
  'note_completion',
  'table_completion',
  'flow_chart_completion',
  'form_completion',
  'summary_word_bank',
  'diagram_labelling',
  'plan_map_labelling',
  'short_answer',
] as const satisfies readonly QuestionTypeCode[];

const toeicSections: ProgramSectionDef[] = [
  ...['part1', 'part2', 'part3', 'part4'].map((code) => ({ code, skill: 'listening', auto: true })),
  ...['part5', 'part6', 'part7'].map((code) => ({ code, skill: 'reading', auto: true })),
  ...['speaking_q1_2', 'speaking_q3_4', 'speaking_q5_7', 'speaking_q8_10', 'speaking_q11'].map((code) => ({ code, skill: 'speaking', auto: false })),
  ...['writing_q1_5', 'writing_q6_7', 'writing_q8'].map((code) => ({ code, skill: 'writing', auto: false })),
];

const ieltsSections: ProgramSectionDef[] = [
  ...['listening_p1', 'listening_p2', 'listening_p3', 'listening_p4'].map((code) => ({ code, skill: 'listening', auto: true })),
  ...['reading_p1', 'reading_p2', 'reading_p3'].map((code) => ({ code, skill: 'reading', auto: true })),
  ...['writing_task1', 'writing_task2'].map((code) => ({ code, skill: 'writing', auto: false })),
  ...['speaking_part1', 'speaking_part2', 'speaking_part3'].map((code) => ({ code, skill: 'speaking', auto: false })),
];

export const PROGRAM_REGISTRY: Readonly<Record<ProgramCode, ProgramDef>> = {
  toeic: {
    code: 'toeic',
    phase: 1,
    launch_flag: null,
    target_language: 'en',
    skills: ['listening', 'reading', 'speaking', 'writing'],
    sections: toeicSections,
    scale: { kind: 'toeic_lr', unit: 'points', min: 10, max: 990, step: 5, skill_min: 5, skill_max: 495, implemented: true },
    target: { kind: 'score', min: 10, max: 990, step: 5, default: 650, levels: [] },
    spoken_sections: ['part1', 'part2'],
    marking: 'per_question',
    question_types: ['mcq_single', 'mcq_multi', 'fill_blank', 'essay', 'speaking'],
    diagnostic: 'toeic_lr',
  },
  ielts: {
    code: 'ielts',
    phase: 2,
    launch_flag: 'ff.catalog.program.ielts',
    target_language: 'en',
    skills: ['listening', 'reading', 'writing', 'speaking'],
    sections: ieltsSections,
    scale: { kind: 'band', unit: 'band', min: 0, max: 9, step: 0.5, skill_min: null, skill_max: null, implemented: true },
    target: { kind: 'score', min: 4, max: 9, step: 0.5, default: 6.5, levels: [] },
    spoken_sections: [],
    marking: 'per_item',
    question_types: [...IELTS_RL_QUESTION_TYPES, 'essay', 'speaking'],
    diagnostic: 'generic',
  },
  jlpt: {
    code: 'jlpt',
    phase: 3,
    launch_flag: 'ff.catalog.program.jlpt',
    target_language: 'ja',
    skills: ['language_knowledge', 'reading', 'listening'],
    sections: [
      { code: 'vocab', skill: 'language_knowledge', auto: true },
      { code: 'grammar', skill: 'language_knowledge', auto: true },
      { code: 'reading', skill: 'reading', auto: true },
      { code: 'listening', skill: 'listening', auto: true },
    ],
    scale: { kind: 'points', unit: 'points', min: 0, max: 180, step: 1, skill_min: 0, skill_max: 60, implemented: false },
    target: { kind: 'level', min: 0, max: 180, step: 1, default: 100, levels: ['N5', 'N4', 'N3', 'N2', 'N1'] },
    spoken_sections: [],
    marking: 'per_item',
    question_types: ['mcq_single', 'ordering', 'handwriting'],
    diagnostic: 'generic',
  },
  hsk: {
    code: 'hsk',
    phase: 3,
    launch_flag: 'ff.catalog.program.hsk',
    target_language: 'zh',
    skills: ['listening', 'reading', 'writing'],
    sections: [
      { code: 'listening', skill: 'listening', auto: true },
      { code: 'reading', skill: 'reading', auto: true },
      { code: 'writing', skill: 'writing', auto: false },
    ],
    scale: { kind: 'points', unit: 'points', min: 0, max: 300, step: 1, skill_min: 0, skill_max: 100, implemented: false },
    target: { kind: 'level', min: 0, max: 300, step: 1, default: 180, levels: ['1', '2', '3', '4', '5', '6', '7-9'] },
    spoken_sections: [],
    marking: 'per_item',
    question_types: ['mcq_single', 'tfng', 'ordering', 'handwriting', 'essay'],
    diagnostic: 'generic',
  },
};

/** Chương trình mặc định khi client cũ không gửi `program` (tương thích ngược GĐ1 – A243) */
export const DEFAULT_PROGRAM: ProgramCode = 'toeic';

export function isProgramCode(v: unknown): v is ProgramCode {
  return typeof v === 'string' && (PROGRAM_CODES as readonly string[]).includes(v);
}

/** Cấu hình chương trình; mã lạ → null */
export function programDef(code: string | null | undefined): ProgramDef | null {
  return isProgramCode(code) ? PROGRAM_REGISTRY[code] : null;
}

/** Danh sách chương trình theo thứ tự hiển thị (giai đoạn rồi thứ tự khai báo) */
export const PROGRAM_LIST: readonly ProgramDef[] = PROGRAM_CODES.map((c) => PROGRAM_REGISTRY[c]);

/** Kỹ năng của phần thi theo registry; mã lạ → null (caller dùng skill của catalog.sections) */
export function skillOfSection(program: string, sectionCode: string): string | null {
  return programDef(program)?.sections.find((s) => s.code === sectionCode)?.skill ?? null;
}

/** Phần thi "đọc trong audio" (ẩn chữ đề/lựa chọn khi đang làm bài) */
export function isSpokenSection(program: string, sectionCode: string): boolean {
  return programDef(program)?.spoken_sections.includes(sectionCode) ?? false;
}

/** Mã phần thi tự chấm của chương trình theo thứ tự (luyện tập theo Part, bộ lọc sổ lỗi) */
export function autoSectionCodes(program: string): string[] {
  return (programDef(program)?.sections ?? []).filter((s) => s.auto).map((s) => s.code);
}

/** Cờ ra mắt đang bật? (TOEIC không có cờ → luôn true). `flagOn` đọc từ FeatureFlagsService / GET /flags */
export function programLaunched(program: string, flagOn: (key: string) => boolean): boolean {
  const def = programDef(program);
  if (!def) return false;
  return def.launch_flag === null || flagOn(def.launch_flag);
}

/** Làm tròn mục tiêu theo bước của thang (IELTS 0,5; TOEIC 5) và cắt trong biên */
export function clampTarget(program: string, value: number): number {
  const t = programDef(program)?.target;
  if (!t || !Number.isFinite(value)) return value;
  const stepped = Math.round(value / t.step) * t.step;
  return Math.min(t.max, Math.max(t.min, Math.round(stepped * 100) / 100));
}

/**
 * C3 – định dạng IELTS Reading/Listening trên máy tính (hằng dùng chung API/web/CMS/seed):
 * Reading 3 passage / 40 câu / 60 phút (Academic | General Training); Listening 4 part / 40 câu / ~30 phút audio, đọc trước mỗi part
 * `preread_sec`, hết part 4 có `review_sec` xem lại (thi máy tính: 2 phút, không có 10 phút chép đáp án như thi giấy).
 */
export const IELTS_CBT = {
  total_marks: 40,
  reading_sections: ['reading_p1', 'reading_p2', 'reading_p3'],
  listening_sections: ['listening_p1', 'listening_p2', 'listening_p3', 'listening_p4'],
  reading_duration_sec: 3600,
  preread_sec: 30,
  review_sec: 120,
} as const;
