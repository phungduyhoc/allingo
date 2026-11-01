import { PROGRAM_CODES, QUESTION_TYPE_CODES, type QuestionContent } from '@allingo/schemas';
import Papa from 'papaparse';
import { z } from 'zod';
import { DIFFICULTY_CODES } from './reference';
import { validateMcqAnswerKeys, validateQuestionContent } from './validate';

/**
 * Nhập hàng loạt câu hỏi (JSON hoặc CSV) – phần thuần để unit test; endpoint Payload gọi `parseImport()`
 * rồi tạo bản ghi `questions` ở trạng thái draft.
 */

export const importRowSchema = z.object({
  program: z.enum(PROGRAM_CODES),
  section_code: z.string().min(1).max(40),
  question_type: z.enum(QUESTION_TYPE_CODES),
  difficulty: z.enum(DIFFICULTY_CODES).optional(),
  topic_code: z.string().max(60).optional(),
  subskill_codes: z.array(z.string().max(60)).max(10).optional(),
  source: z.enum(['human', 'ai', 'licensed']).optional(),
  /** Khoá idempotent (tuỳ chọn): trùng → bỏ qua, không tạo bản sao */
  import_key: z.string().max(120).optional(),
  content: z.unknown(),
});
export type ImportRow = z.infer<typeof importRowSchema>;

export interface ParsedImportRow {
  row: number;
  program: ImportRow['program'];
  sectionCode: string;
  questionType: ImportRow['question_type'];
  difficulty: ImportRow['difficulty'];
  topicCode: string | undefined;
  subskillCodes: string[];
  source: 'human' | 'ai' | 'licensed';
  importKey: string | undefined;
  content: QuestionContent;
}

export interface ImportParseResult {
  rows: ParsedImportRow[];
  errors: Array<{ row: number; message: string }>;
  format: 'json' | 'csv';
}

const CSV_REQUIRED = ['program', 'section_code', 'question_type', 'stem', 'option_a', 'option_b', 'correct'] as const;

function cleanCell(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

/** Chuyển một dòng CSV (mcq_single) thành ImportRow */
export function csvRecordToImportRow(rec: Record<string, unknown>): { ok: true; row: ImportRow } | { ok: false; message: string } {
  const get = (k: string) => cleanCell(rec[k]);
  const missing = CSV_REQUIRED.filter((k) => !get(k));
  if (missing.length) return { ok: false, message: `Thiếu cột bắt buộc: ${missing.join(', ')}.` };
  const questionType = get('question_type');
  if (questionType !== 'mcq_single') {
    return { ok: false, message: `CSV chỉ hỗ trợ question_type = mcq_single (nhận "${questionType}"); dạng khác dùng JSON.` };
  }
  // A, B luôn giữ; C–F chỉ giữ khi có nội dung (Part 2 có 3 lựa chọn)
  const options = (['a', 'b', 'c', 'd', 'e', 'f'] as const)
    .map((k) => ({ key: k.toUpperCase(), text: get(`option_${k}`) }))
    .filter((o, idx) => idx < 2 || o.text.length > 0);
  const correct = get('correct').toUpperCase();
  const explanationVi = get('explanation_vi');
  const explanationEn = get('explanation_en');
  const evidence = get('evidence');
  const tags = get('tags')
    .split('|')
    .map((t) => t.trim())
    .filter(Boolean);
  const content: Record<string, unknown> = {
    type: 'mcq_single',
    stem: get('stem'),
    options,
    answer_key: { correct },
    tags,
  };
  if (explanationVi || explanationEn) content.explanation = { ...(explanationVi ? { vi: explanationVi } : {}), ...(explanationEn ? { en: explanationEn } : {}) };
  if (evidence) content.evidence = evidence;
  const subskills = get('subskill_codes')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
  const row: Record<string, unknown> = {
    program: get('program').toLowerCase(),
    section_code: get('section_code').toLowerCase(),
    question_type: 'mcq_single',
    content,
  };
  if (get('difficulty')) row.difficulty = get('difficulty');
  if (get('topic_code')) row.topic_code = get('topic_code');
  if (subskills.length) row.subskill_codes = subskills;
  if (get('source')) row.source = get('source');
  if (get('import_key')) row.import_key = get('import_key');
  const parsed = importRowSchema.safeParse(row);
  if (!parsed.success) return { ok: false, message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  return { ok: true, row: parsed.data };
}

function normalizeRows(raw: Array<{ row: number; value: unknown }>, format: 'json' | 'csv'): ImportParseResult {
  const rows: ParsedImportRow[] = [];
  const errors: ImportParseResult['errors'] = [];
  for (const { row, value } of raw) {
    const parsed = importRowSchema.safeParse(value);
    if (!parsed.success) {
      errors.push({ row, message: parsed.error.issues.map((i) => `${i.path.join('.') || '(gốc)'}: ${i.message}`).join('; ') });
      continue;
    }
    const r = parsed.data;
    const content = validateQuestionContent(r.question_type, r.content);
    if (!content.ok) {
      errors.push({ row, message: content.message });
      continue;
    }
    const keyErr = validateMcqAnswerKeys(content.value);
    if (keyErr) {
      errors.push({ row, message: keyErr });
      continue;
    }
    rows.push({
      row,
      program: r.program,
      sectionCode: r.section_code,
      questionType: r.question_type,
      difficulty: r.difficulty,
      topicCode: r.topic_code,
      subskillCodes: r.subskill_codes ?? [],
      source: r.source ?? 'human',
      importKey: r.import_key,
      content: content.value,
    });
  }
  return { rows, errors, format };
}

/** Nhập từ chuỗi JSON: mảng ImportRow hoặc `{ questions: ImportRow[] }` */
export function parseImportJson(text: string): ImportParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return { rows: [], errors: [{ row: 0, message: `JSON không hợp lệ: ${err instanceof Error ? err.message : String(err)}` }], format: 'json' };
  }
  const arr = Array.isArray(data) ? data : data && typeof data === 'object' && Array.isArray((data as { questions?: unknown }).questions) ? (data as { questions: unknown[] }).questions : null;
  if (!arr) return { rows: [], errors: [{ row: 0, message: 'JSON phải là mảng câu hỏi hoặc { "questions": [...] }.' }], format: 'json' };
  return normalizeRows(
    arr.map((value, i) => ({ row: i + 1, value })),
    'json',
  );
}

/** Nhập từ CSV (header bắt buộc). Số dòng tính theo dòng dữ liệu (dòng 1 = dòng đầu sau header). */
export function parseImportCsv(text: string): ImportParseResult {
  const parsed = Papa.parse<Record<string, unknown>>(text.replace(/^\uFEFF/, ''), { header: true, skipEmptyLines: 'greedy', transformHeader: (h) => h.trim().toLowerCase() });
  const errors: ImportParseResult['errors'] = parsed.errors
    .filter((e) => e.code !== 'UndetectableDelimiter')
    .map((e) => ({ row: (e.row ?? -1) + 1, message: `CSV: ${e.message}` }));
  const raw: Array<{ row: number; value: unknown }> = [];
  parsed.data.forEach((rec, i) => {
    const conv = csvRecordToImportRow(rec);
    if (conv.ok) raw.push({ row: i + 1, value: conv.row });
    else errors.push({ row: i + 1, message: conv.message });
  });
  const result = normalizeRows(raw, 'csv');
  return { ...result, errors: [...errors, ...result.errors].sort((a, b) => a.row - b.row) };
}

export function parseImport(text: string, format: 'json' | 'csv'): ImportParseResult {
  return format === 'csv' ? parseImportCsv(text) : parseImportJson(text);
}

/** Đoán định dạng theo tên tệp/nội dung */
export function detectImportFormat(fileName: string | undefined, text: string): 'json' | 'csv' {
  if (fileName?.toLowerCase().endsWith('.csv')) return 'csv';
  if (fileName?.toLowerCase().endsWith('.json')) return 'json';
  const head = text.trimStart().charAt(0);
  return head === '[' || head === '{' ? 'json' : 'csv';
}
