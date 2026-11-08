import { PROGRAM_CODES } from '../common.js';
import { questionContentSchema, type QuestionContent } from '../question/content.js';
import { DRAFT_DIFFICULTY_LEVELS } from './draft-blueprint.js';

/**
 * B2 – mẫu nhập câu hỏi từ Excel (.xlsx): định nghĩa cột (dùng chung cho tệp mẫu và bộ đọc), chuyển một dòng → nội dung câu
 * `mcq_single` + passage (tuỳ chọn). Lỗi trả theo dòng + cột với mã ổn định (web dịch bằng i18n), không chuỗi hiển thị cứng.
 * Dòng ví dụ của tệp mẫu có `import_key` bắt đầu bằng `VD-` → luôn bỏ qua.
 */

export interface ImportColumn {
  key: string;
  required: boolean;
  /** Chú thích cột (sheet "Hướng dẫn" của tệp mẫu) */
  note: { vi: string; en: string };
  example: [string, string];
  width: number;
}

export const IMPORT_EXAMPLE_PREFIX = 'VD-';
export const IMPORT_MAX_ROWS = 1000;
export const IMPORT_MAX_BYTES = 1_000_000;

export const IMPORT_COLUMNS: readonly ImportColumn[] = [
  { key: 'import_key', required: false, width: 16, note: { vi: 'Khoá nhận diện dòng (tuỳ chọn, ≤ 120 ký tự). Nhập lại cùng khoá → bỏ qua, không tạo bản sao. Dòng ví dụ bắt đầu bằng "VD-" luôn bị bỏ qua.', en: 'Optional idempotency key (≤ 120 chars). Re-importing the same key is skipped. Example rows starting with "VD-" are ignored.' }, example: ['VD-001', 'VD-002'] },
  { key: 'program', required: true, width: 10, note: { vi: `Chương trình: ${PROGRAM_CODES.join(' | ')}.`, en: `Program: ${PROGRAM_CODES.join(' | ')}.` }, example: ['toeic', 'toeic'] },
  { key: 'section_code', required: true, width: 12, note: { vi: 'Mã phần thi, vd. TOEIC part1 … part7.', en: 'Section code, e.g. TOEIC part1 … part7.' }, example: ['part5', 'part7'] },
  { key: 'question_type', required: true, width: 13, note: { vi: 'Dạng câu – mẫu Excel hỗ trợ mcq_single (trắc nghiệm một đáp án).', en: 'Question type – the Excel template supports mcq_single.' }, example: ['mcq_single', 'mcq_single'] },
  { key: 'difficulty', required: false, width: 10, note: { vi: `Độ khó CEFR: ${DRAFT_DIFFICULTY_LEVELS.join(' | ')}.`, en: `CEFR difficulty: ${DRAFT_DIFFICULTY_LEVELS.join(' | ')}.` }, example: ['B1', 'B2'] },
  { key: 'topic_code', required: false, width: 12, note: { vi: 'Chủ đề (mã catalog.topics), vd. business, travel, logistics.', en: 'Topic code, e.g. business, travel, logistics.' }, example: ['logistics', 'office'] },
  { key: 'subskill_codes', required: false, width: 18, note: { vi: 'Kỹ năng con, phân tách bằng dấu |.', en: 'Subskill codes separated by |.' }, example: ['grammar', 'reading:detail'] },
  { key: 'stem', required: true, width: 48, note: { vi: 'Đề bài (bắt buộc, trừ TOEIC Part 1/2 – đề được đọc trong audio). Chỗ trống viết "______".', en: 'Stem (required except TOEIC Part 1/2). Use "______" for blanks.' }, example: ['The shipment from our Danang warehouse ______ on Monday morning.', 'What is the main purpose of the e-mail?'] },
  { key: 'option_a', required: true, width: 22, note: { vi: 'Phương án A (bắt buộc).', en: 'Option A (required).' }, example: ['arrived', 'To confirm a booking'] },
  { key: 'option_b', required: true, width: 22, note: { vi: 'Phương án B (bắt buộc).', en: 'Option B (required).' }, example: ['arriving', 'To request a refund'] },
  { key: 'option_c', required: false, width: 22, note: { vi: 'Phương án C (TOEIC Part 2 có 3 phương án).', en: 'Option C (TOEIC Part 2 has 3 options).' }, example: ['arrives', 'To change a delivery date'] },
  { key: 'option_d', required: false, width: 22, note: { vi: 'Phương án D.', en: 'Option D.' }, example: ['to arrive', 'To introduce a new service'] },
  { key: 'correct', required: true, width: 9, note: { vi: 'Đáp án đúng: A | B | C | D (phải là phương án có nội dung).', en: 'Correct key: A | B | C | D (must be a filled option).' }, example: ['A', 'C'] },
  { key: 'explanation_vi', required: false, width: 36, note: { vi: 'Giải thích tiếng Việt (hạt giống cho AI giải thích).', en: 'Vietnamese explanation.' }, example: ['"on Monday morning" + quá khứ → arrived.', 'Câu 2 của e-mail nêu yêu cầu đổi ngày giao.'] },
  { key: 'explanation_en', required: false, width: 36, note: { vi: 'Giải thích tiếng Anh.', en: 'English explanation.' }, example: ['Past time marker → past simple.', 'The second sentence asks to change the date.'] },
  { key: 'evidence', required: false, width: 30, note: { vi: 'Trích đoạn quyết định đáp án (Review/giải thích).', en: 'Evidence span from the text.' }, example: ['', 'could we move the delivery to Thursday'] },
  { key: 'passage_key', required: false, width: 14, note: { vi: 'Part 6/7: các dòng cùng passage_key dùng chung một đoạn văn (nội dung lấy ở dòng đầu tiên có passage_body).', en: 'Part 6/7: rows sharing passage_key share one passage.' }, example: ['', 'P7-EMAIL-01'] },
  { key: 'passage_title', required: false, width: 18, note: { vi: 'Tiêu đề đoạn văn.', en: 'Passage title.' }, example: ['', 'E-mail: delivery change'] },
  { key: 'passage_body', required: false, width: 48, note: { vi: 'Nội dung đoạn văn. Bộ đôi/bộ ba Part 7: mỗi văn bản mở đầu bằng một dòng [Tiêu đề] → tách thành tab từng văn bản.', en: 'Passage body. Part 7 multi-text: start each text with a [Title] line → one tab per text.' }, example: ['', 'From: Lan Pham\nTo: Orders team\nCould we move the delivery to Thursday?'] },
  { key: 'tags', required: false, width: 14, note: { vi: 'Nhãn, phân tách bằng dấu |.', en: 'Tags separated by |.' }, example: ['tense', 'purpose'] },
];
export const IMPORT_COLUMN_KEYS = IMPORT_COLUMNS.map((c) => c.key);

export const IMPORT_ISSUE_CODES = [
  'missing_column',
  'required',
  'invalid_value',
  'unsupported_type',
  'answer_not_in_options',
  'content_invalid',
  'too_long',
  'passage_conflict',
  'duplicate_in_file',
  'duplicate_in_bank',
  'import_key_exists',
  'unknown_section',
  'too_many_rows',
] as const;
export type ImportIssueCode = (typeof IMPORT_ISSUE_CODES)[number];

export interface ImportIssue {
  row: number;
  column: string | null;
  code: ImportIssueCode;
  level: 'error' | 'warning';
  params?: Record<string, string | number>;
}

export interface ImportRowParsed {
  row: number;
  import_key: string | null;
  program: string;
  section_code: string;
  question_type: 'mcq_single';
  difficulty: string | null;
  topic_code: string | null;
  subskill_codes: string[];
  content: QuestionContent;
  passage: { key: string; title: string | null; body: string | null } | null;
}

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '');
const splitPipe = (v: string) => v.split('|').map((x) => x.trim()).filter(Boolean);

/** Thiếu cột bắt buộc trong dòng tiêu đề */
export function missingImportColumns(header: readonly string[]): string[] {
  const have = new Set(header.map((h) => h.trim().toLowerCase()));
  return IMPORT_COLUMNS.filter((c) => c.required && !have.has(c.key)).map((c) => c.key);
}

export const isExampleRow = (rec: Record<string, unknown>) => clean(rec.import_key).toUpperCase().startsWith(IMPORT_EXAMPLE_PREFIX);

/**
 * Một dòng (đã ánh xạ theo tiêu đề cột) → câu hỏi. `row` = số dòng trong sheet (dòng tiêu đề = 1).
 * Trả lỗi theo cột; dòng có lỗi `error` không được nhập.
 */
export function parseImportRow(row: number, rec: Record<string, unknown>): { value: ImportRowParsed | null; issues: ImportIssue[] } {
  const issues: ImportIssue[] = [];
  const g = (k: string) => clean(rec[k]);
  const err = (column: string | null, code: ImportIssueCode, params?: Record<string, string | number>) => issues.push({ row, column, code, level: 'error', ...(params ? { params } : {}) });
  const program = g('program').toLowerCase();
  const section = g('section_code').toLowerCase();
  const qtype = g('question_type').toLowerCase() || 'mcq_single';
  if (!program) err('program', 'required');
  else if (!(PROGRAM_CODES as readonly string[]).includes(program)) err('program', 'invalid_value', { value: program });
  if (!section) err('section_code', 'required');
  if (qtype !== 'mcq_single') err('question_type', 'unsupported_type', { value: qtype });
  const spoken = program === 'toeic' && (section === 'part1' || section === 'part2');
  const stem = g('stem');
  if (!stem && !spoken) err('stem', 'required');
  if (stem.length > 8000) err('stem', 'too_long', { max: 8000 });
  const options = (['a', 'b', 'c', 'd'] as const).map((k) => ({ key: k.toUpperCase(), text: g(`option_${k}`) }));
  for (const k of ['a', 'b'] as const) if (!g(`option_${k}`) && !spoken) err(`option_${k}`, 'required');
  for (const o of options) if (o.text.length > 2000) err(`option_${o.key.toLowerCase()}`, 'too_long', { max: 2000 });
  // A, B luôn giữ; C, D chỉ giữ khi có nội dung (Part 2: 3 phương án)
  const kept = options.filter((o, i) => i < 2 || o.text.length > 0);
  const correct = g('correct').toUpperCase();
  if (!correct) err('correct', 'required');
  else if (!/^[A-D]$/.test(correct)) err('correct', 'invalid_value', { value: correct });
  else if (!kept.some((o) => o.key === correct)) err('correct', 'answer_not_in_options', { value: correct });
  const difficulty = g('difficulty').toUpperCase();
  if (difficulty && !(DRAFT_DIFFICULTY_LEVELS as readonly string[]).includes(difficulty)) err('difficulty', 'invalid_value', { value: difficulty });
  const importKey = g('import_key');
  if (importKey.length > 120) err('import_key', 'too_long', { max: 120 });
  const passageKey = g('passage_key');
  const passageBody = g('passage_body');
  if (passageBody.length > 20_000) err('passage_body', 'too_long', { max: 20_000 });
  if ((passageBody || g('passage_title')) && !passageKey) err('passage_key', 'required');

  const explanation: Record<string, string> = {};
  if (g('explanation_vi')) explanation.vi = g('explanation_vi');
  if (g('explanation_en')) explanation.en = g('explanation_en');
  const raw: Record<string, unknown> = { type: 'mcq_single', stem, options: kept, answer_key: { correct }, tags: splitPipe(g('tags')).slice(0, 20) };
  if (Object.keys(explanation).length) raw.explanation = explanation;
  if (g('evidence')) raw.evidence = g('evidence');
  if (issues.length) return { value: null, issues };
  const parsed = questionContentSchema.safeParse(raw);
  if (!parsed.success) {
    err(String(parsed.error.issues[0]?.path[0] ?? 'stem'), 'content_invalid', { detail: parsed.error.issues[0]?.message.slice(0, 120) ?? '' });
    return { value: null, issues };
  }
  return {
    value: {
      row,
      import_key: importKey || null,
      program,
      section_code: section,
      question_type: 'mcq_single',
      difficulty: difficulty || null,
      topic_code: g('topic_code') || null,
      subskill_codes: splitPipe(g('subskill_codes')).slice(0, 10),
      content: parsed.data,
      passage: passageKey ? { key: passageKey, title: g('passage_title') || null, body: passageBody || null } : null,
    },
    issues,
  };
}
