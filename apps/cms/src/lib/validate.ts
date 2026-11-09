import {
  IELTS_CBT,
  QUESTION_TYPE_CODES,
  questionContentSchemasByType,
  runTestSetChecks,
  type QuestionContent,
  type QuestionTypeCode,
  type SectionSpec,
  type TestSetCheckResult,
} from '@allingo/schemas';
import type { z } from 'zod';
import { TOEIC_FULL_COUNTS, TOEIC_SECTIONS } from './reference';
import { marksOfContent } from './test-set-builder';

/**
 * Hàm thuần kiểm tra dữ liệu CMS – không phụ thuộc Payload, có unit test (test/validate.test.ts).
 * Thông điệp lỗi bằng tiếng Việt vì hiển thị cho biên tập viên trong admin.
 */

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; message: string; issues: string[] };

export function isQuestionTypeCode(v: unknown): v is QuestionTypeCode {
  return typeof v === 'string' && (QUESTION_TYPE_CODES as readonly string[]).includes(v);
}

function formatZodIssues(error: z.ZodError): string[] {
  return error.issues.map((i) => {
    const path = i.path.length ? i.path.map((p) => (typeof p === 'number' ? `[${p}]` : `.${String(p)}`)).join('').replace(/^\./, '') : '(gốc)';
    return `${path}: ${i.message}`;
  });
}

/**
 * Validate `content` theo `questionType` bằng Zod của packages/schemas.
 * - `content.type` phải trùng `questionType` (tránh lệch giữa select và JSON).
 * - Trả về giá trị đã parse (có default: tags, listen_policy...) để lưu chuẩn hoá.
 */
export function validateQuestionContent(questionType: unknown, content: unknown): ValidationResult<QuestionContent> {
  if (!isQuestionTypeCode(questionType)) {
    return { ok: false, message: 'Chưa chọn dạng câu hỏi (questionType) hợp lệ.', issues: [] };
  }
  if (content === null || content === undefined || typeof content !== 'object' || Array.isArray(content)) {
    return { ok: false, message: 'Nội dung câu hỏi (content) phải là một đối tượng JSON.', issues: [] };
  }
  const typeInContent = (content as { type?: unknown }).type;
  if (typeInContent !== undefined && typeInContent !== questionType) {
    return {
      ok: false,
      message: `content.type = ${JSON.stringify(typeInContent)} không khớp dạng câu đã chọn "${questionType}".`,
      issues: [],
    };
  }
  const schema = questionContentSchemasByType[questionType] as z.ZodType<QuestionContent>;
  const parsed = schema.safeParse({ ...(content as Record<string, unknown>), type: questionType });
  if (!parsed.success) {
    const issues = formatZodIssues(parsed.error);
    return {
      ok: false,
      message: `Nội dung câu hỏi dạng "${questionType}" không hợp lệ: ${issues.slice(0, 5).join('; ')}${issues.length > 5 ? ` (+${issues.length - 5} lỗi khác)` : ''}`,
      issues,
    };
  }
  return { ok: true, value: parsed.data };
}

/** Kiểm tra bổ sung cho MCQ: đáp án đúng phải nằm trong options */
export function validateMcqAnswerKeys(content: QuestionContent): string | null {
  if (content.type === 'mcq_single') {
    const keys = new Set(content.options.map((o) => o.key));
    if (!keys.has(content.answer_key.correct)) return `Đáp án đúng "${content.answer_key.correct}" không nằm trong các lựa chọn.`;
    if (keys.size !== content.options.length) return 'Mã lựa chọn (key) bị trùng.';
  }
  if (content.type === 'mcq_multi') {
    const keys = new Set(content.options.map((o) => o.key));
    const missing = content.answer_key.correct.filter((k) => !keys.has(k));
    if (missing.length) return `Đáp án đúng ${missing.join(', ')} không nằm trong các lựa chọn.`;
    if (keys.size !== content.options.length) return 'Mã lựa chọn (key) bị trùng.';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Bộ đề (test_sets)
// ---------------------------------------------------------------------------

export type TestSetKind = 'full' | 'mini' | 'part_drill' | 'diagnostic' | 'topic_pack';

export interface TestSetShape {
  program: string;
  kind: TestSetKind;
  sections: Array<{ sectionCode: string; durationSec?: number | null }>;
  items: Array<{ question: unknown; sectionCode: string; sortOrder: number; groupKey?: string | null; points?: number | null }>;
}

/**
 * Kiểm tra cấu trúc bộ đề:
 * - TOEIC `full`: đủ Part 1–7, đúng số câu 6/25/39/30/30/16/54 (tổng 200).
 * - `mini`/`part_drill`/`diagnostic`/`topic_pack`: ≥ 1 câu.
 * - Mọi item phải thuộc một section đã khai báo; sortOrder không trùng trong cùng section.
 */
export function validateTestSetStructure(set: TestSetShape): string[] {
  const errors: string[] = [];
  const declared = new Set(set.sections.map((s) => s.sectionCode));
  if (set.sections.length === 0) errors.push('Bộ đề phải có ít nhất một phần (sections).');
  if (declared.size !== set.sections.length) errors.push('Mã phần (sectionCode) trong sections bị trùng.');
  if (set.items.length === 0) errors.push('Bộ đề phải có ít nhất một câu hỏi.');

  const countBySection = new Map<string, number>();
  const seenOrder = new Set<string>();
  set.items.forEach((it, idx) => {
    if (!declared.has(it.sectionCode)) errors.push(`Câu #${idx + 1}: phần "${it.sectionCode}" chưa khai báo trong sections.`);
    const k = `${it.sectionCode}#${it.sortOrder}`;
    if (seenOrder.has(k)) errors.push(`Câu #${idx + 1}: sortOrder ${it.sortOrder} trùng trong phần "${it.sectionCode}".`);
    seenOrder.add(k);
    countBySection.set(it.sectionCode, (countBySection.get(it.sectionCode) ?? 0) + 1);
  });

  if (set.program === 'toeic' && set.kind === 'full') {
    for (const s of TOEIC_SECTIONS) {
      const have = countBySection.get(s.code) ?? 0;
      if (!declared.has(s.code)) errors.push(`Đề TOEIC full thiếu phần ${s.code}.`);
      else if (have !== s.count) errors.push(`Đề TOEIC full: ${s.code} cần đúng ${TOEIC_FULL_COUNTS[s.code]} câu, hiện có ${have}.`);
    }
    for (const code of declared) {
      if (!(code in TOEIC_FULL_COUNTS)) errors.push(`Đề TOEIC full chỉ gồm part1–part7, không có "${code}".`);
    }
  }
  return errors;
}

/** C3 – thông tin câu cho kiểm tra cấp bộ đề (đọc từ collection questions + passage + media) */
export interface ItemCheckInfo {
  /** content JSON của câu (để đếm số mục – markCount) */
  content: unknown;
  /** Câu hoặc passage của câu có audio */
  hasAudio: boolean;
  /** Định danh audio (media/asset id) – phát hiện part có nhiều audio */
  audioKey: string | null;
}

/** Số mục chuẩn từng part/passage IELTS (catalog.sections.question_count – seed core): Listening 10 × 4, Reading 13/13/14 */
export function ieltsSectionSpecs(): SectionSpec[] {
  return [
    ...IELTS_CBT.listening_sections.map((code, i) => ({ code, skill: 'listening', question_count: 10, sort_order: i + 1 })),
    ...IELTS_CBT.reading_sections.map((code, i) => ({ code, skill: 'reading', question_count: i === 2 ? 14 : 13, sort_order: 10 + i })),
  ];
}

/**
 * C3 – kiểm tra tự động bộ đề theo mục đánh số (`runTestSetChecks` của packages/schemas): IELTS full đủ 40 câu hỏi mỗi kỹ năng và đúng số
 * mục từng part/passage, đánh số "Questions 1–40" liên tục, mỗi part Listening có audio (một audio liên tục). Câu chưa tải được thông tin
 * → coi như thiếu số mục (đứt dãy số). Trả lỗi (chặn lưu/phát hành) và cảnh báo (chỉ hiển thị).
 */
export function testSetCheckIssues(set: TestSetShape, info: ReadonlyMap<string, ItemCheckInfo>): { errors: string[]; warnings: string[] } {
  const results = runTestSetChecks({
    program: set.program,
    kind: set.kind,
    sections: set.program === 'ielts' ? ieltsSectionSpecs() : [],
    items: set.items.map((it) => {
      const q = info.get(relationshipId(it.question) ?? '');
      return { section_code: it.sectionCode, sort_order: it.sortOrder, group_key: it.groupKey ?? null, marks: q ? marksOfContent(q.content) : null, has_audio: q?.hasAudio ?? false, audio_key: q?.audioKey ?? null };
    }),
  });
  return {
    errors: results.filter((r) => r.level === 'error').map(describeTestSetCheck),
    warnings: results.filter((r) => r.level === 'warning').map(describeTestSetCheck),
  };
}

/** Thông điệp tiếng Việt cho biên tập viên theo mã kiểm tra bộ đề */
export function describeTestSetCheck(r: TestSetCheckResult): string {
  const p = r.params ?? {};
  switch (r.code) {
    case 'numbering_gap':
      return `Đánh số câu hỏi bị đứt tại câu số ${p.number} (${p.section}, thứ tự ${p.sort_order}): nội dung câu không hợp lệ hoặc không xác định được số mục.`;
    case 'ielts_mark_total':
      return `Đề IELTS ${p.skill === 'listening' ? 'Listening' : 'Reading'} đầy đủ cần đúng ${p.expected} câu hỏi, hiện có ${p.actual}.`;
    case 'ielts_section_marks':
      return `${p.section}: cần đúng ${p.expected} câu hỏi (mục), hiện có ${p.actual}.`;
    case 'listening_part_audio_missing':
      return `${p.section}: part Listening chưa có audio (câu hoặc passage script phải gắn audio).`;
    case 'listening_part_multiple_audio':
      return `${p.section}: part có ${p.count} audio khác nhau – định dạng thi máy tính phát liên tục một audio mỗi part.`;
    default:
      return String(r.code);
  }
}

/** C3 – `level` gửi catalog (catalog.test_sets.level): chỉ IELTS – hình thức Reading Academic/GT; đề chỉ Listening để trống */
export function catalogLevelOf(d: { program?: string | null; ieltsModule?: string | null }): string | undefined {
  return d.program === 'ielts' && d.ieltsModule ? d.ieltsModule : undefined;
}

/** Mọi câu trong bộ đề phải đã `published` (đã đồng bộ sang catalog) */
export function findUnpublishedItems(
  items: TestSetShape['items'],
  statusById: ReadonlyMap<string, string>,
): Array<{ index: number; questionId: string; status: string | undefined }> {
  const bad: Array<{ index: number; questionId: string; status: string | undefined }> = [];
  items.forEach((it, index) => {
    const id = relationshipId(it.question);
    const status = id ? statusById.get(id) : undefined;
    if (status !== 'published') bad.push({ index, questionId: id ?? '', status });
  });
  return bad;
}

/** Lấy id từ giá trị relationship của Payload (có thể là id hoặc document đã populate) */
export function relationshipId(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (typeof v === 'object' && 'id' in v) {
    const id = (v as { id?: unknown }).id;
    return typeof id === 'string' || typeof id === 'number' ? String(id) : null;
  }
  return null;
}
