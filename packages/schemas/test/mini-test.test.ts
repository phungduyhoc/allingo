import { describe, expect, it } from 'vitest';
import {
  TIMED_DRILL_SEC_PER_QUESTION,
  TOEIC_MINI_BLUEPRINT_60,
  attemptEventSchema,
  attemptMediaListSchema,
  generateMiniTest,
  isSpokenTextSection,
  mulberry32,
  redactSpokenText,
  timedDrillSeconds,
  toPublicContent,
  validateTestSetStructure,
  type MiniBankItem,
  type QuestionContent,
  type SectionSpec,
} from '../src/index.js';

/** Section TOEIC L&R theo seed core (question_count chuẩn) */
const TOEIC: SectionSpec[] = [
  { code: 'part1', skill: 'listening', question_count: 6, sort_order: 1 },
  { code: 'part2', skill: 'listening', question_count: 25, sort_order: 2 },
  { code: 'part3', skill: 'listening', question_count: 39, sort_order: 3 },
  { code: 'part4', skill: 'listening', question_count: 30, sort_order: 4 },
  { code: 'part5', skill: 'reading', question_count: 30, sort_order: 5 },
  { code: 'part6', skill: 'reading', question_count: 16, sort_order: 6 },
  { code: 'part7', skill: 'reading', question_count: 54, sort_order: 7 },
];

let n = 0;
const qid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

/** Ngân hàng giả lập ~2 đề TOEIC: câu đơn P1/P2/P5, nhóm 3 câu P3/P4, nhóm 4 câu P6, P7 đoạn đơn 2–4 câu + bộ nhiều văn bản 5 câu */
function makeBank(): MiniBankItem[] {
  const bank: MiniBankItem[] = [];
  const singles = (section: string, count: number) => {
    for (let i = 0; i < count; i++) bank.push({ question_id: qid(), section_code: section, group_key: null });
  };
  const groups = (section: string, sizes: number[]) => {
    sizes.forEach((size, gi) => {
      for (let k = 0; k < size; k++) bank.push({ question_id: qid(), section_code: section, group_key: `${section}-g${gi}`, order: k + 1 });
    });
  };
  singles('part1', 12);
  singles('part2', 50);
  groups('part3', Array(26).fill(3));
  groups('part4', [...Array(20).fill(3), 2]); // một nhóm thiếu câu (2) – không được chọn vì group_sizes [3]
  singles('part5', 60);
  groups('part6', Array(8).fill(4));
  groups('part7', [2, 2, 3, 3, 4, 4, 2, 3, 4, 2, 3, 4, 2, 3, 4, 5, 5, 5, 5, 5]);
  return bank;
}

describe('generateMiniTest (Sprint 4 – mini test lặp lại được)', () => {
  const bank = makeBank();

  it('mulberry32: cùng seed → cùng dãy, khác seed → khác dãy, giá trị trong [0,1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const c = mulberry32(43);
    const sa = Array.from({ length: 5 }, a);
    expect(Array.from({ length: 5 }, b)).toEqual(sa);
    expect(Array.from({ length: 5 }, c)).not.toEqual(sa);
    expect(sa.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  it('100 seed ngẫu nhiên: luôn hợp lệ cấu trúc mini, đúng 60 câu 6/10/9/9/10/4/12, nhóm trọn vẹn và liền nhau', () => {
    const rnd = mulberry32(2026);
    for (let i = 0; i < 100; i++) {
      const seed = 1 + Math.floor(rnd() * 2_000_000_000);
      const r = generateMiniTest(bank, TOEIC_MINI_BLUEPRINT_60, seed);
      const report = validateTestSetStructure('mini', TOEIC, r.items.map((it) => ({ question_ref: it.question_id, section_code: it.section_code, sort_order: it.sort_order, group_key: it.group_key })));
      expect(report.issues, `seed ${seed}`).toEqual([]);
      expect(r.items).toHaveLength(60);
      expect(r.by_section).toEqual({ part1: 6, part2: 10, part3: 9, part4: 9, part5: 10, part6: 4, part7: 12 });
      expect(r.shortfall).toEqual([]);
      // Nhóm trọn vẹn: mọi câu của một nhóm đã chọn đều có mặt
      const chosenGroups = new Set(r.items.map((it) => it.group_key).filter(Boolean));
      for (const g of chosenGroups) expect(r.items.filter((it) => it.group_key === g).length).toBe(bank.filter((b) => b.group_key === g).length);
      // Part 7 có ít nhất một bộ nhiều văn bản (nhóm 5 câu); Part 4 không lấy nhóm thiếu câu
      const p7 = new Map<string, number>();
      for (const it of r.items.filter((x) => x.section_code === 'part7')) p7.set(it.group_key!, (p7.get(it.group_key!) ?? 0) + 1);
      expect([...p7.values()]).toContain(5);
      expect(r.items.some((it) => it.group_key === 'part4-g20')).toBe(false);
      // Thứ tự Part tăng dần
      const order = r.items.map((it) => TOEIC.find((s) => s.code === it.section_code)!.sort_order);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
    }
  });

  it('cùng seed → cùng câu & thứ tự (không phụ thuộc thứ tự ngân hàng); khác seed → khác đề', () => {
    const a = generateMiniTest(bank, TOEIC_MINI_BLUEPRINT_60, 42);
    const b = generateMiniTest([...bank].reverse(), TOEIC_MINI_BLUEPRINT_60, 42);
    expect(b.items).toEqual(a.items);
    expect(b.bank_fingerprint).toBe(a.bank_fingerprint);
    const c = generateMiniTest(bank, TOEIC_MINI_BLUEPRINT_60, 43);
    expect(c.items.map((i) => i.question_id)).not.toEqual(a.items.map((i) => i.question_id));
  });

  it('ngân hàng một Part đổi không làm đổi lựa chọn của Part khác (PRNG theo section)', () => {
    const a = generateMiniTest(bank, TOEIC_MINI_BLUEPRINT_60, 7);
    const b = generateMiniTest([...bank, { question_id: qid(), section_code: 'part1', group_key: null }], TOEIC_MINI_BLUEPRINT_60, 7);
    const pick = (r: typeof a, s: string) => r.items.filter((i) => i.section_code === s).map((i) => i.question_id);
    expect(pick(b, 'part5')).toEqual(pick(a, 'part5'));
    expect(pick(b, 'part7')).toEqual(pick(a, 'part7'));
    expect(b.bank_fingerprint).not.toBe(a.bank_fingerprint);
  });

  it('ngân hàng thiếu (chỉ có Reading): báo shortfall, phần còn lại vẫn hợp lệ', () => {
    const readingOnly = bank.filter((b) => ['part5', 'part6', 'part7'].includes(b.section_code));
    const r = generateMiniTest(readingOnly, TOEIC_MINI_BLUEPRINT_60, 1);
    expect(r.items).toHaveLength(26);
    expect(r.shortfall.map((s) => s.section_code)).toEqual(['part1', 'part2', 'part3', 'part4']);
    expect(r.shortfall.every((s) => s.reason === 'bank_too_small' && s.selected === 0)).toBe(true);
    expect(validateTestSetStructure('mini', TOEIC, r.items.map((it) => ({ question_ref: it.question_id, section_code: it.section_code, sort_order: it.sort_order, group_key: it.group_key }))).ok).toBe(true);
  });

  it('không có tổ hợp đúng số câu → lấy tổng lớn nhất ≤ yêu cầu; thiếu bộ 5 câu → requirement_unmet', () => {
    const odd: MiniBankItem[] = [0, 1, 2].flatMap((g) => [0, 1, 2].map((k) => ({ question_id: qid(), section_code: 'part7', group_key: `x${g}`, order: k })));
    const r = generateMiniTest(odd, { code: 't', sections: [{ section_code: 'part7', count: 8, require_groups: [{ sizes: [5], min: 1 }] }] }, 3);
    expect(r.by_section.part7).toBe(6);
    expect(r.shortfall.map((s) => s.reason).sort()).toEqual(['no_exact_combination', 'requirement_unmet']);
    expect(() => generateMiniTest(odd, TOEIC_MINI_BLUEPRINT_60, -1)).toThrow(RangeError);
  });
});

describe('timed drill & ẩn transcript (Sprint 4)', () => {
  it('giây mặc định theo Part; ghi đè per_question_sec', () => {
    expect(TIMED_DRILL_SEC_PER_QUESTION).toMatchObject({ part1: 20, part2: 20, part3: 35, part4: 35, part5: 25, part6: 60, part7: 60 });
    expect(timedDrillSeconds(['part1', 'part3', 'part7'])).toBe(115);
    expect(timedDrillSeconds(['ielts_reading_p1'])).toBe(45);
    expect(timedDrillSeconds(['part5', 'part5'], 30)).toBe(60);
  });

  it('Part 1/2 TOEIC: xoá chữ đề bài và lựa chọn (transcript) nhưng giữ key/media', () => {
    expect(isSpokenTextSection('toeic', 'part2')).toBe(true);
    expect(isSpokenTextSection('toeic', 'part3')).toBe(false);
    expect(isSpokenTextSection('ielts', 'part1')).toBe(false);
    const content: QuestionContent = {
      type: 'mcq_single',
      stem: 'Where is the meeting?',
      stem_i18n: { vi: 'Cuộc họp ở đâu?' },
      options: [
        { key: 'A', text: 'At three.' },
        { key: 'B', text: 'In room 2.' },
      ],
      answer_key: { correct: 'B' },
      media: { listen_policy: 'once', pause_ms: 5000, audio_asset_id: '00000000-0000-4000-8000-000000000001' },
      tags: [],
    };
    const red = redactSpokenText(toPublicContent(content)) as Record<string, unknown>;
    expect(red.stem).toBe('');
    expect(red.stem_i18n).toBeUndefined();
    expect(red.options).toEqual([
      { key: 'A', text: '' },
      { key: 'B', text: '' },
    ]);
    expect(red.media).toEqual(content.media);
    expect(JSON.stringify(red)).not.toMatch(/meeting|room 2|At three/);
  });

  it('sự kiện audio: meta question_id/asset_id phải là UUID; meta quá lớn bị từ chối', () => {
    expect(attemptEventSchema.safeParse({ type: 'audio_started', meta: { question_id: '00000000-0000-4000-8000-000000000001', asset_id: '00000000-0000-4000-8000-000000000002' } }).success).toBe(true);
    expect(attemptEventSchema.safeParse({ type: 'audio_started', meta: { question_id: 'q1' } }).success).toBe(false);
    expect(attemptEventSchema.safeParse({ type: 'focus_lost', meta: { question_id: 'q1' } }).success).toBe(true);
    expect(attemptEventSchema.safeParse({ type: 'part_switch', meta: { blob: 'x'.repeat(3000) } }).success).toBe(false);
    expect(attemptMediaListSchema.safeParse({ data: [{ id: '00000000-0000-4000-8000-000000000001', kind: 'audio', url: 'https://x', expires_at: null }] }).success).toBe(true);
  });
});
