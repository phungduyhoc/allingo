/**
 * Kiểm tra cấu trúc bộ đề trước khi phát hành (Sprint 2 – test set builder). Hàm thuần: nhận cấu trúc section từ
 * catalog.sections (question_count, skill) và danh sách item của bộ đề.
 * - full: mỗi kỹ năng có mặt phải đủ mọi section của kỹ năng đó, đúng số câu từng section (TOEIC L&R: 6/25/39/30/30/16/54 = 200).
 * - part_drill: đúng một section.
 * - mini/diagnostic/topic_pack: ≥ 1 câu, không vượt số câu chuẩn của section.
 * - Mọi kiểu: không trùng câu; câu cùng nhóm (passage/group_key) phải liền nhau trong cùng section; sort_order tăng dần không trùng.
 * - C3: chương trình đếm theo mục (`marking = per_item` – IELTS) so `question_count` với tổng `marks` của item (markCount; thiếu → 1)
 *   thay cho số câu catalog – một câu TFNG 5 mệnh đề = 5 câu hỏi. `by_section`/`total` khi đó cũng là số mục.
 */

export interface SectionSpec {
  code: string;
  skill: string;
  question_count: number | null;
  sort_order: number;
}

export interface TestSetItemSpec {
  question_ref: string;
  section_code: string;
  sort_order: number;
  group_key?: string | null;
  /** C3 – số mục đánh số của câu (markCount); chỉ dùng khi `marking = per_item` */
  marks?: number;
}

export interface StructureOptions {
  /** registry `marking` của chương trình – mặc định per_question (đếm câu catalog như trước C3) */
  marking?: 'per_question' | 'per_item';
}

export type TestSetKind = 'full' | 'mini' | 'part_drill' | 'diagnostic' | 'topic_pack';

export interface StructureIssue {
  code: 'unknown_section' | 'missing_section' | 'count_mismatch' | 'duplicate_question' | 'group_not_contiguous' | 'duplicate_sort_order' | 'too_many' | 'empty' | 'drill_multi_section';
  section?: string;
  message: string;
  expected?: number;
  actual?: number;
}

export interface StructureReport {
  ok: boolean;
  total: number;
  by_section: Record<string, number>;
  issues: StructureIssue[];
}

export function validateTestSetStructure(kind: TestSetKind, sections: readonly SectionSpec[], items: readonly TestSetItemSpec[], options: StructureOptions = {}): StructureReport {
  const perItem = options.marking === 'per_item';
  const weight = (it: TestSetItemSpec) => (perItem ? Math.max(1, it.marks ?? 1) : 1);
  const issues: StructureIssue[] = [];
  const specByCode = new Map(sections.map((s) => [s.code, s]));
  const bySection: Record<string, number> = {};
  const seenRefs = new Set<string>();
  const seenOrder = new Set<number>();

  if (items.length === 0) issues.push({ code: 'empty', message: 'Bộ đề chưa có câu hỏi nào.' });

  for (const it of items) {
    if (!specByCode.has(it.section_code)) issues.push({ code: 'unknown_section', section: it.section_code, message: `Section "${it.section_code}" không thuộc chương trình.` });
    bySection[it.section_code] = (bySection[it.section_code] ?? 0) + weight(it);
    if (seenRefs.has(it.question_ref)) issues.push({ code: 'duplicate_question', section: it.section_code, message: `Câu ${it.question_ref} xuất hiện nhiều lần.` });
    seenRefs.add(it.question_ref);
    if (seenOrder.has(it.sort_order)) issues.push({ code: 'duplicate_sort_order', section: it.section_code, message: `Thứ tự ${it.sort_order} bị trùng.` });
    seenOrder.add(it.sort_order);
  }

  // Nhóm theo passage phải liền nhau và cùng section
  const ordered = [...items].sort((a, b) => a.sort_order - b.sort_order);
  const closedGroups = new Set<string>();
  let current: { key: string; section: string } | null = null;
  for (const it of ordered) {
    const key = it.group_key ?? null;
    if (current && key !== current.key) {
      closedGroups.add(current.key);
      current = null;
    }
    if (key) {
      if (closedGroups.has(key)) issues.push({ code: 'group_not_contiguous', section: it.section_code, message: `Nhóm câu "${key}" bị tách rời; các câu cùng đoạn văn phải liền nhau.` });
      else if (current && current.section !== it.section_code) issues.push({ code: 'group_not_contiguous', section: it.section_code, message: `Nhóm câu "${key}" nằm ở nhiều section.` });
      current = { key, section: it.section_code };
    }
  }

  const presentSkills = new Set(items.map((i) => specByCode.get(i.section_code)?.skill).filter((s): s is string => !!s));
  if (kind === 'full') {
    for (const spec of sections) {
      if (!presentSkills.has(spec.skill) || spec.question_count == null) continue;
      const actual = bySection[spec.code] ?? 0;
      if (actual === 0) issues.push({ code: 'missing_section', section: spec.code, message: `Đề đầy đủ thiếu section "${spec.code}" (${spec.question_count} câu).`, expected: spec.question_count, actual });
      else if (actual !== spec.question_count) issues.push({ code: 'count_mismatch', section: spec.code, message: `Section "${spec.code}" cần đúng ${spec.question_count} câu, hiện có ${actual}.`, expected: spec.question_count, actual });
    }
  } else {
    if (kind === 'part_drill' && Object.keys(bySection).length > 1) issues.push({ code: 'drill_multi_section', message: 'Bộ luyện theo Part chỉ được chứa một section.' });
    for (const [code, actual] of Object.entries(bySection)) {
      const spec = specByCode.get(code);
      if (spec?.question_count != null && actual > spec.question_count) issues.push({ code: 'too_many', section: code, message: `Section "${code}" có ${actual} câu, vượt chuẩn ${spec.question_count}.`, expected: spec.question_count, actual });
    }
  }

  return { ok: issues.length === 0, total: items.reduce((s, it) => s + weight(it), 0), by_section: bySection, issues };
}
