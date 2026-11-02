/* eslint-disable no-console */
import { unitLevel } from '@allingo/scoring';
import type { Db } from '../../src/client.js';
import { assertStructure, loadSectionSpecs, upsertSeedTestSet, type SeedContext, type SeedItem } from './seed-helpers.js';
import { LISTENING_FULL_01 } from './toeic-listening-01.js';
import { READING_FULL_01 } from './toeic-reading-01.js';
import type { PartSeedResult } from './reading-01.seed.js';

/**
 * Bài chẩn đoán TOEIC 01 (Sprint 9 – ADR-0031): test set `kind = diagnostic`, ≈ 60 câu phủ Part 1–7 và các subskill, HAI mức khó
 * mỗi Part (mức 1 = câu lẻ A2 / nhóm không có câu B2; mức 2 = câu lẻ từ B1 / nhóm có câu B2 – cùng quy tắc `unitLevel` của
 * @allingo/scoring mà API dùng khi chọn câu thích ứng). Câu lấy TỪ NGÂN HÀNG đã seed (Listening 01 + Reading 01, tự biên soạn,
 * source = human) – KHÔNG tạo câu mới, KHÔNG sửa tệp đề; câu trùng với đề full 01 (ASSUMPTIONS A131).
 * Người học chỉ làm ≈ 30 câu (blueprint TOEIC_DIAGNOSTIC_BLUEPRINT); phần còn lại là "dự trữ" để thích ứng theo mức.
 * Idempotent: upsert theo code, xoá/ghi lại item.
 */
export const DIAGNOSTIC_01 = {
  code: 'toeic-diagnostic-01',
  title: { vi: 'Bài chẩn đoán đầu vào TOEIC L&R (thích ứng, ~ 30 câu)', en: 'TOEIC L&R placement test (adaptive, ~30 questions)' },
  /** Không tính giờ (mode diagnostic); thời lượng gợi ý cho UI */
  durationSec: 30 * 60,
} as const;

/** Số câu lẻ mỗi mức (Part 1/2/5) và số nhóm mỗi mức (Part 3/4/6/7) */
const SINGLES_PER_LEVEL: Record<string, number> = { part1: 2, part2: 4, part5: 6 };
const GROUPS_PER_LEVEL: Record<string, number> = { part3: 2, part4: 1, part6: 1, part7: 2 };

interface BankQuestion {
  key: string;
  number: number;
  section: string;
  group_key?: string;
  subskill?: string;
  difficulty: 'A2' | 'B1' | 'B2';
}

/**
 * Chọn câu (thuần, xác định – test db kiểm tra): câu lẻ xoay vòng theo subskill để phủ rộng, mỗi mức đủ số lượng;
 * nhóm passage ưu tiên nhóm ít câu (bài đọc/nghe ngắn) rồi theo số câu.
 */
export function buildDiagnosticSelection(bank: readonly BankQuestion[] = [...LISTENING_FULL_01.questions, ...READING_FULL_01.questions]): SeedItem[] {
  const sections = ['part1', 'part2', 'part3', 'part4', 'part5', 'part6', 'part7'];
  const out: SeedItem[] = [];
  for (const section of sections) {
    const qs = bank.filter((q) => q.section === section).sort((a, b) => a.number - b.number);
    if (SINGLES_PER_LEVEL[section]) {
      const per = SINGLES_PER_LEVEL[section];
      const picked: BankQuestion[] = [];
      for (const level of [1, 2] as const) {
        const pool = qs.filter((q) => unitLevel([{ difficulty: q.difficulty, group_key: null }]) === level);
        const bySub = new Map<string, BankQuestion[]>();
        for (const q of pool) bySub.set(q.subskill ?? '', [...(bySub.get(q.subskill ?? '') ?? []), q]);
        const lists = [...bySub.values()];
        let n = 0;
        for (let round = 0; n < per && lists.some((l) => l.length > round); round++) {
          for (const l of lists) {
            if (n >= per) break;
            const q = l[round];
            if (q) {
              picked.push(q);
              n++;
            }
          }
        }
      }
      for (const q of picked.sort((a, b) => a.number - b.number)) out.push({ key: q.key, section, group_key: null });
    } else {
      const per = GROUPS_PER_LEVEL[section]!;
      const groups = new Map<string, BankQuestion[]>();
      for (const q of qs) if (q.group_key) groups.set(q.group_key, [...(groups.get(q.group_key) ?? []), q]);
      const chosen: BankQuestion[][] = [];
      for (const level of [1, 2] as const) {
        const cands = [...groups.values()]
          .filter((g) => unitLevel(g.map((q) => ({ difficulty: q.difficulty, group_key: q.group_key ?? null }))) === level)
          .sort((a, b) => a.length - b.length || a[0]!.number - b[0]!.number)
          .slice(0, per);
        chosen.push(...cands);
      }
      for (const g of chosen.sort((a, b) => a[0]!.number - b[0]!.number)) for (const q of g) out.push({ key: q.key, section, group_key: q.group_key ?? null });
    }
  }
  return out;
}

export async function seedDiagnostic01(db: Db, ctx: SeedContext, listening: PartSeedResult, reading: PartSeedResult): Promise<string> {
  const items = buildDiagnosticSelection();
  assertStructure(await loadSectionSpecs(db), 'diagnostic', DIAGNOSTIC_01.code, items);
  const questionIdByKey = new Map([...listening.questionIdByKey, ...reading.questionIdByKey]);
  const id = await upsertSeedTestSet(db, ctx, { code: DIAGNOSTIC_01.code, title: DIAGNOSTIC_01.title, kind: 'diagnostic', durationSec: DIAGNOSTIC_01.durationSec, items, questionIdByKey });
  console.log(`[seed:demo] ${DIAGNOSTIC_01.code} questions=${items.length} (kind=diagnostic)`);
  return id;
}
