import { z } from 'zod';
import { localizedTextSchema, programCodeSchema } from '../common.js';

/**
 * B2 – blueprint cho "AI soạn nháp cả đề" và kiểm tra ràng buộc blueprint của trình dựng bộ đề (CMS, A26).
 * Hàm thuần (không DB): phân bố độ khó theo tỉ lệ (phần dư lớn nhất – tất định), chia số câu Part nhóm thành các nhóm passage,
 * so số câu từng Part của bộ đề với blueprint.
 */

export const DRAFT_DIFFICULTY_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
export type DraftDifficulty = (typeof DRAFT_DIFFICULTY_LEVELS)[number];

export const draftBlueprintSectionSchema = z.object({
  section_code: z.string().min(1).max(32),
  count: z.number().int().min(1).max(100),
  /** Kích thước nhóm passage (Part 3/4: [3], Part 6: [4], Part 7: [2..5]); bỏ trống = theo catalog.sections.rules.group_size */
  group_sizes: z.array(z.number().int().min(1).max(10)).min(1).max(6).optional(),
  /** Part 7: số văn bản mỗi bộ (1 = đoạn đơn, 2 = bộ đôi, 3 = bộ ba) – áp cho các nhóm ≥ 5 câu; mặc định 1 */
  multi_passage_texts: z.number().int().min(1).max(3).optional(),
});
export type DraftBlueprintSection = z.infer<typeof draftBlueprintSectionSchema>;

export const draftBlueprintSchema = z.object({
  sections: z.array(draftBlueprintSectionSchema).min(1).max(12),
  /** Tỉ lệ độ khó (tương đối, vd. {A2: 30, B1: 50, B2: 20}); bỏ trống = toàn bộ B1 */
  difficulty_mix: z.partialRecord(z.enum(DRAFT_DIFFICULTY_LEVELS), z.number().min(0).max(100)).optional(),
  /** Chủ đề xoay vòng giữa các lô/nhóm (mã catalog.topics, vd. business, travel) */
  topics: z.array(z.string().min(1).max(64)).max(12).default([]),
});
export type DraftBlueprint = z.infer<typeof draftBlueprintSchema>;

export const draftTestInputSchema = z.object({
  program: programCodeSchema.default('toeic'),
  kind: z.enum(['full', 'mini', 'part_drill']).default('mini'),
  title: localizedTextSchema.optional(),
  /** Mã đề nháp; mặc định `<program>-ai-draft-<8 ký tự job>` */
  code: z.string().regex(/^[a-z0-9][a-z0-9_-]{2,63}$/).optional(),
  blueprint: draftBlueprintSchema,
});
export type DraftTestInput = z.infer<typeof draftTestInputSchema>;

/** Phân bố `total` câu theo tỉ lệ độ khó (phần dư lớn nhất, hoà → theo thứ tự cấp độ) – trả mảng cấp độ cho từng câu, dễ trước khó sau */
export function allocateDifficulty(total: number, mix: Partial<Record<DraftDifficulty, number>> | undefined): DraftDifficulty[] {
  const entries = DRAFT_DIFFICULTY_LEVELS.map((lv) => [lv, Math.max(0, mix?.[lv] ?? 0)] as const).filter(([, w]) => w > 0);
  if (total <= 0) return [];
  if (!entries.length) return Array.from({ length: total }, () => 'B1');
  const sum = entries.reduce((s, [, w]) => s + w, 0);
  const raw = entries.map(([lv, w]) => ({ lv, exact: (w / sum) * total }));
  const base = raw.map((r) => ({ lv: r.lv, n: Math.floor(r.exact), rem: r.exact - Math.floor(r.exact) }));
  let left = total - base.reduce((s, b) => s + b.n, 0);
  for (const b of [...base].sort((a, b2) => b2.rem - a.rem || DRAFT_DIFFICULTY_LEVELS.indexOf(a.lv) - DRAFT_DIFFICULTY_LEVELS.indexOf(b2.lv))) {
    if (left <= 0) break;
    b.n++;
    left--;
  }
  return base.flatMap((b) => Array.from({ length: b.n }, () => b.lv));
}

/**
 * Chia `count` câu của Part nhóm thành các nhóm có kích thước thuộc `sizes` (ưu tiên nhóm lớn, phần còn lại ghép nhóm nhỏ nhất vừa).
 * Không chia hết (vd. Part 3 count 10, sizes [3]) → null.
 */
export function planGroups(count: number, sizes: readonly number[]): number[] | null {
  const s = [...new Set(sizes)].filter((x) => x > 0).sort((a, b) => b - a);
  if (!s.length || count <= 0) return null;
  // Quy hoạch động: số nhóm ít nhất, ưu tiên nhóm lớn
  const best: Array<number[] | null> = Array.from({ length: count + 1 }, () => null);
  best[0] = [];
  for (let n = 1; n <= count; n++) {
    for (const size of s) {
      const prev = n - size >= 0 ? best[n - size] : null;
      if (!prev) continue;
      const cand = [...prev, size];
      const cur = best[n];
      if (!cur || cand.length < cur.length) best[n] = cand;
    }
  }
  const out = best[count];
  return out ? [...out].sort((a, b) => b - a) : null;
}

export interface BlueprintCountRow {
  section_code: string;
  required: number;
  actual: number;
  diff: number;
}

/** So số câu từng Part của bộ đề với blueprint (thiếu/thừa) – trình dựng bộ đề chặn xuất bản khi `ok = false` */
export function checkBlueprintCounts(blueprint: ReadonlyArray<{ section_code: string; count: number }>, items: ReadonlyArray<{ section_code: string }>): { ok: boolean; rows: BlueprintCountRow[]; extra_sections: string[] } {
  const actual = new Map<string, number>();
  for (const it of items) actual.set(it.section_code, (actual.get(it.section_code) ?? 0) + 1);
  const rows = blueprint.map((b) => {
    const a = actual.get(b.section_code) ?? 0;
    return { section_code: b.section_code, required: b.count, actual: a, diff: a - b.count };
  });
  const known = new Set(blueprint.map((b) => b.section_code));
  const extra = [...actual.keys()].filter((k) => !known.has(k));
  return { ok: rows.every((r) => r.diff === 0) && extra.length === 0, rows, extra_sections: extra };
}

/**
 * Tách body passage gộp `[Tiêu đề]\n…` (quy ước seed/merge – S24) thành các văn bản: chỉ khi có ≥ 2 dòng nhãn đứng riêng
 * (không phải mốc số `[131]`/`[1]`). Dùng khi nhập Excel/AI trả body gộp → `catalog.passage_parts`.
 */
export function splitMergedPassage(body: string): Array<{ title: string; body: string }> {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const heads: number[] = [];
  lines.forEach((l, i) => {
    const m = /^\s*\[([^\]\n]{1,80})\]\s*$/.exec(l);
    if (m && !/^\d{1,4}$/.test(m[1]!.trim())) heads.push(i);
  });
  if (heads.length < 2) return [];
  const out: Array<{ title: string; body: string }> = [];
  heads.forEach((h, k) => {
    const end = heads[k + 1] ?? lines.length;
    const title = /^\s*\[([^\]\n]{1,80})\]\s*$/.exec(lines[h]!)![1]!.trim();
    const text = lines.slice(h + 1, end).join('\n').trim();
    if (text) out.push({ title, body: text });
  });
  return out.length >= 2 ? out : [];
}
