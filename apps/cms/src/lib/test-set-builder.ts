import { checkBlueprintCounts, TOEIC_MINI_BLUEPRINT_60, type BlueprintCountRow } from '@allingo/schemas';
import { TOEIC_FULL_COUNTS, TOEIC_SECTIONS } from './reference';

/**
 * A26 – trình dựng bộ đề kéo thả (custom view Payload `/admin/test-set-builder`): hàm thuần (unit test) thao tác trên cấu trúc
 * `test_sets.sections/items` của CMS. Đơn vị kéo thả trong một Part là "khối": câu đơn hoặc trọn nhóm cùng `groupKey` (passage) –
 * nhóm luôn liền nhau như API yêu cầu (`group_not_contiguous`). Lưu lại = PATCH collection → hook hiện có kiểm tra + phát hành catalog.
 */

export interface BuilderItem {
  question: string;
  sectionCode: string;
  groupKey: string | null;
  points: number;
}
export interface BuilderSection {
  sectionCode: string;
  durationSec: number | null;
}
export interface BuilderState {
  sections: BuilderSection[];
  items: BuilderItem[];
}
export interface BuilderUnit {
  key: string;
  groupKey: string | null;
  items: BuilderItem[];
}

/** Câu hỏi trong ngân hàng (collection questions) – tối thiểu cho trình dựng */
export interface BankQuestion {
  id: string;
  title: string;
  sectionCode: string;
  status: string;
  difficulty: string | null;
  passageId: string | null;
}

/** Khối kéo thả của một Part theo thứ tự hiện tại */
export function unitsOf(state: BuilderState, sectionCode: string): BuilderUnit[] {
  const out: BuilderUnit[] = [];
  for (const it of state.items.filter((i) => i.sectionCode === sectionCode)) {
    const last = out[out.length - 1];
    if (it.groupKey && last && last.groupKey === it.groupKey) last.items.push(it);
    else out.push({ key: it.groupKey ? `g:${it.groupKey}:${it.question}` : `q:${it.question}`, groupKey: it.groupKey, items: [it] });
  }
  return out;
}

function withSectionItems(state: BuilderState, sectionCode: string, items: BuilderItem[]): BuilderState {
  // Giữ thứ tự các Part theo `sections`; item của Part khác giữ nguyên
  const bySection = new Map<string, BuilderItem[]>();
  for (const it of state.items) if (it.sectionCode !== sectionCode) bySection.set(it.sectionCode, [...(bySection.get(it.sectionCode) ?? []), it]);
  bySection.set(sectionCode, items);
  const ordered = state.sections.flatMap((s) => bySection.get(s.sectionCode) ?? []);
  const orphan = [...bySection.entries()].filter(([code]) => !state.sections.some((s) => s.sectionCode === code)).flatMap(([, v]) => v);
  return { ...state, items: [...ordered, ...orphan] };
}

const move = <T>(arr: T[], from: number, to: number): T[] => {
  if (from === to || from < 0 || from >= arr.length) return arr;
  const copy = [...arr];
  const [x] = copy.splice(from, 1);
  copy.splice(Math.max(0, Math.min(copy.length, to)), 0, x!);
  return copy;
};

/** Đổi thứ tự Part (kéo thả / nút lên-xuống) – câu đi theo Part */
export function moveSection(state: BuilderState, from: number, to: number): BuilderState {
  const sections = move(state.sections, from, to);
  const order = sections.map((x) => x.sectionCode);
  // sort ổn định: thứ tự câu trong từng Part giữ nguyên
  const items = [...state.items].sort((a, b) => order.indexOf(a.sectionCode) - order.indexOf(b.sectionCode));
  return { sections, items };
}

/** Đổi thứ tự khối (câu đơn / trọn nhóm passage) trong một Part */
export function moveUnit(state: BuilderState, sectionCode: string, from: number, to: number): BuilderState {
  const units = move(unitsOf(state, sectionCode), from, to);
  return withSectionItems(state, sectionCode, units.flatMap((u) => u.items));
}

/** Bớt một câu (nhóm còn lại vẫn liền nhau) */
export function removeQuestion(state: BuilderState, questionId: string): BuilderState {
  return { ...state, items: state.items.filter((i) => i.question !== questionId) };
}

/**
 * Thêm câu từ ngân hàng vào Part của câu (tự thêm Part nếu chưa có); câu cùng passage được đặt ngay sau nhóm đã có.
 * Câu đã có trong bộ đề → bỏ qua. Trả số câu thêm được.
 */
export function addQuestions(state: BuilderState, questions: BankQuestion[]): { state: BuilderState; added: number } {
  let next = state;
  let added = 0;
  for (const q of questions) {
    if (next.items.some((i) => i.question === q.id)) continue;
    if (!next.sections.some((s) => s.sectionCode === q.sectionCode)) {
      const order = TOEIC_SECTIONS.map((s) => s.code);
      const sections = [...next.sections, { sectionCode: q.sectionCode, durationSec: null }].sort((a, b) => (order.indexOf(a.sectionCode) + 1 || 99) - (order.indexOf(b.sectionCode) + 1 || 99));
      next = { ...next, sections };
    }
    const list = next.items.filter((i) => i.sectionCode === q.sectionCode);
    const item: BuilderItem = { question: q.id, sectionCode: q.sectionCode, groupKey: q.passageId, points: 1 };
    const lastOfGroup = q.passageId ? list.map((i) => i.groupKey).lastIndexOf(q.passageId) : -1;
    const items = lastOfGroup >= 0 ? [...list.slice(0, lastOfGroup + 1), item, ...list.slice(lastOfGroup + 1)] : [...list, item];
    next = withSectionItems(next, q.sectionCode, items);
    added++;
  }
  return { state: next, added };
}

/** Bỏ Part không còn câu nào */
export function pruneSections(state: BuilderState): BuilderState {
  return { ...state, sections: state.sections.filter((s) => state.items.some((i) => i.sectionCode === s.sectionCode)) };
}

/** Dữ liệu ghi lại collection: sortOrder chạy 1…n theo thứ tự hiển thị (duy nhất toàn bộ đề như API kiểm tra) */
export function toCollectionData(state: BuilderState): { sections: BuilderSection[]; items: Array<BuilderItem & { sortOrder: number }> } {
  return { sections: state.sections, items: state.items.map((it, i) => ({ ...it, sortOrder: i + 1 })) };
}

/** Collection → trạng thái trình dựng (sắp theo Part rồi sortOrder) */
export function fromCollection(doc: { sections?: Array<{ sectionCode?: string | null; durationSec?: number | null }> | null; items?: Array<{ question?: unknown; sectionCode?: string | null; sortOrder?: number | null; groupKey?: string | null; points?: number | null }> | null }): BuilderState {
  const sections = (doc.sections ?? []).filter((s) => s.sectionCode).map((s) => ({ sectionCode: s.sectionCode!, durationSec: s.durationSec ?? null }));
  const order = sections.map((s) => s.sectionCode);
  const items = (doc.items ?? [])
    .map((it) => ({ question: relId(it.question), sectionCode: it.sectionCode ?? '', groupKey: it.groupKey ?? null, points: it.points ?? 1, sortOrder: it.sortOrder ?? 0 }))
    .filter((it): it is BuilderItem & { question: string; sortOrder: number } => !!it.question)
    .sort((a, b) => (order.indexOf(a.sectionCode) - order.indexOf(b.sectionCode)) || a.sortOrder - b.sortOrder)
    .map(({ sortOrder: _s, ...rest }) => rest);
  return { sections, items };
}

function relId(v: unknown): string | null {
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (v && typeof v === 'object' && 'id' in v) return String(v.id);
  return null;
}

/** Blueprint mẫu cho nút "Áp blueprint" của trình dựng */
export const BUILDER_BLUEPRINTS: Record<string, { label: string; sections: Array<{ sectionCode: string; count: number }> }> = {
  toeic_full_200: { label: 'TOEIC L&R đầy đủ (200 câu)', sections: TOEIC_SECTIONS.map((s) => ({ sectionCode: s.code, count: TOEIC_FULL_COUNTS[s.code] ?? s.count })) },
  toeic_mini_60: { label: 'TOEIC mini 60 câu', sections: TOEIC_MINI_BLUEPRINT_60.sections.map((s) => ({ sectionCode: s.section_code, count: s.count })) },
};

/** Kiểm tra blueprint (đủ số câu mỗi Part) – chặn xuất bản khi lệch */
export function blueprintReport(blueprint: ReadonlyArray<{ sectionCode: string; count: number }>, state: { items: ReadonlyArray<{ sectionCode: string }> }): { ok: boolean; rows: BlueprintCountRow[]; extra_sections: string[] } {
  return checkBlueprintCounts(
    blueprint.map((b) => ({ section_code: b.sectionCode, count: b.count })),
    state.items.map((i) => ({ section_code: i.sectionCode })),
  );
}

/** Thông điệp lỗi blueprint (tiếng Việt – hiển thị cho biên tập viên) */
export function blueprintErrors(report: ReturnType<typeof blueprintReport>): string[] {
  return [
    ...report.rows.filter((r) => r.diff !== 0).map((r) => `${r.section_code}: cần ${r.required} câu, hiện có ${r.actual}${r.diff < 0 ? ` (thiếu ${-r.diff})` : ` (thừa ${r.diff})`}.`),
    ...report.extra_sections.map((c) => `${c}: không có trong blueprint.`),
  ];
}
