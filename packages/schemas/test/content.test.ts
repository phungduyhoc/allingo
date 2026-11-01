import { describe, expect, it } from 'vitest';
import { allowedTargets, contentRoleOf, evaluateTransition, findBatchDuplicates, targetOf, trigramSimilarity, validateTestSetStructure, type SectionSpec } from '../src/index.js';

describe('workflow nội dung (dùng chung CMS/API)', () => {
  it('luồng chuẩn: draft → ai_checked (qua AI) → review1 → review2 → published', () => {
    expect(evaluateTransition({ from: 'draft', to: 'ai_checked', role: 'editor', viaAiCheck: true, aiReport: { verdict: 'pass' } })).toMatchObject({ ok: true, effect: { review: { stage: 'ai_check', decision: 'approve' } } });
    expect(evaluateTransition({ from: 'ai_checked', to: 'review1', role: 'editor' })).toMatchObject({ ok: true, effect: { review: { stage: 'review1', decision: 'submit' } } });
    expect(evaluateTransition({ from: 'review1', to: 'review2', role: 'teacher', actorId: 't1' })).toMatchObject({ ok: true, effect: { review: { stage: 'review1', decision: 'approve' } } });
    const pub = evaluateTransition({ from: 'review2', to: 'published', role: 'admin', actorId: 'a1', review1ApproverId: 't1' });
    expect(pub).toMatchObject({ ok: true, effect: { publish: true, review: { stage: 'review2', decision: 'approve' } } });
  });

  it('chặn: ai_checked chỉ qua AI; verdict fail chặn gửi duyệt; editor không duyệt; teacher không duyệt vòng 2', () => {
    expect(evaluateTransition({ from: 'draft', to: 'ai_checked', role: 'admin' })).toMatchObject({ ok: false, code: 'ai_check_only' });
    expect(evaluateTransition({ from: 'draft', to: 'ai_checked', role: 'editor', viaAiCheck: true, aiReport: { verdict: 'fail' } })).toMatchObject({ ok: false, code: 'ai_check_failed' });
    expect(evaluateTransition({ from: 'draft', to: 'review1', role: 'editor', aiReport: { verdict: 'fail' } })).toMatchObject({ ok: false, code: 'ai_check_failed' });
    expect(evaluateTransition({ from: 'review1', to: 'review2', role: 'editor' })).toMatchObject({ ok: false, code: 'role_not_allowed' });
    expect(evaluateTransition({ from: 'review2', to: 'published', role: 'teacher' })).toMatchObject({ ok: false, code: 'role_not_allowed' });
    expect(evaluateTransition({ from: 'draft', to: 'published', role: 'admin' })).toMatchObject({ ok: false, code: 'invalid_transition' });
  });

  it('nguyên tắc 4 mắt: người duyệt vòng 2 khác vòng 1', () => {
    expect(evaluateTransition({ from: 'review2', to: 'published', role: 'admin', actorId: 'a1', review1ApproverId: 'a1' })).toMatchObject({ ok: false, code: 'four_eyes' });
  });

  it('needs_change/reject cần ghi chú; reject ở review1 → rejected, needs_change → draft', () => {
    expect(evaluateTransition({ from: 'review1', to: 'draft', role: 'teacher' })).toMatchObject({ ok: false, code: 'note_required' });
    expect(evaluateTransition({ from: 'review1', to: 'draft', role: 'teacher', note: 'Sửa đáp án C' })).toMatchObject({ ok: true, effect: { review: { decision: 'needs_change' } } });
    expect(targetOf('review1', 'review1', 'reject')).toBe('rejected');
    expect(targetOf('review1', 'review1', 'needs_change')).toBe('draft');
    expect(targetOf('review2', 'review2', 'approve')).toBe('published');
    expect(targetOf('draft', 'review1', 'approve')).toBeNull();
  });

  it('retire và reopen; vai trò hệ thống → vai trò nội dung', () => {
    expect(evaluateTransition({ from: 'published', to: 'retired', role: 'teacher' })).toMatchObject({ ok: true, effect: { retire: true } });
    expect(evaluateTransition({ from: 'retired', to: 'draft', role: 'teacher' })).toMatchObject({ ok: false, code: 'role_not_allowed' });
    expect(allowedTargets('review1', 'teacher').sort()).toEqual(['draft', 'rejected', 'review2']);
    expect(contentRoleOf(['learner', 'superadmin'])).toBe('admin');
    expect(contentRoleOf(['learner', 'teacher'])).toBe('teacher');
    expect(contentRoleOf(['learner'])).toBeNull();
  });
});

const TOEIC: SectionSpec[] = [
  ['part1', 'listening', 6],
  ['part2', 'listening', 25],
  ['part3', 'listening', 39],
  ['part4', 'listening', 30],
  ['part5', 'reading', 30],
  ['part6', 'reading', 16],
  ['part7', 'reading', 54],
].map(([code, skill, n], i) => ({ code: code as string, skill: skill as string, question_count: n as number, sort_order: i + 1 }));

function items(spec: Record<string, number>, groupEvery = 0) {
  const out: Array<{ question_ref: string; section_code: string; sort_order: number; group_key: string | null }> = [];
  let order = 1;
  for (const [code, n] of Object.entries(spec)) for (let i = 0; i < n; i++) out.push({ question_ref: `${code}-${i}`, section_code: code, sort_order: order++, group_key: groupEvery ? `${code}-g${Math.floor(i / groupEvery)}` : null });
  return out;
}

describe('cấu trúc bộ đề', () => {
  it('TOEIC L&R đầy đủ 200 câu hợp lệ; thiếu 1 câu Part 7 → count_mismatch', () => {
    const full = items({ part1: 6, part2: 25, part3: 39, part4: 30, part5: 30, part6: 16, part7: 54 });
    const ok = validateTestSetStructure('full', TOEIC, full);
    expect(ok.ok).toBe(true);
    expect(ok.total).toBe(200);
    const bad = validateTestSetStructure('full', TOEIC, full.slice(0, -1));
    expect(bad.ok).toBe(false);
    expect(bad.issues).toContainEqual(expect.objectContaining({ code: 'count_mismatch', section: 'part7', expected: 54, actual: 53 }));
  });

  it('đề Reading đầy đủ không cần Part nghe; thiếu cả Part 6 → missing_section', () => {
    expect(validateTestSetStructure('full', TOEIC, items({ part5: 30, part6: 16, part7: 54 })).ok).toBe(true);
    const r = validateTestSetStructure('full', TOEIC, items({ part5: 30, part7: 54 }));
    expect(r.issues).toContainEqual(expect.objectContaining({ code: 'missing_section', section: 'part6' }));
  });

  it('mini/part_drill: vượt chuẩn, nhiều section, trùng câu, nhóm passage tách rời', () => {
    expect(validateTestSetStructure('mini', TOEIC, items({ part5: 10 })).ok).toBe(true);
    expect(validateTestSetStructure('mini', TOEIC, items({ part1: 7 })).issues[0]?.code).toBe('too_many');
    expect(validateTestSetStructure('part_drill', TOEIC, items({ part5: 5, part6: 4 })).issues.map((i) => i.code)).toContain('drill_multi_section');
    const dup = items({ part5: 3 });
    dup.push({ ...dup[0]!, sort_order: 99 });
    expect(validateTestSetStructure('mini', TOEIC, dup).issues.map((i) => i.code)).toContain('duplicate_question');
    const grouped = items({ part7: 4 }, 2);
    grouped[3]!.group_key = 'part7-g0';
    expect(validateTestSetStructure('mini', TOEIC, grouped).issues.map((i) => i.code)).toContain('group_not_contiguous');
    expect(validateTestSetStructure('mini', TOEIC, []).issues.map((i) => i.code)).toContain('empty');
  });
});

describe('phát hiện trùng (trigram)', () => {
  it('cùng câu khác hoa thường/dấu câu/khoảng trống → ≈1; câu khác hẳn → thấp', () => {
    expect(trigramSimilarity('The invoice must be ______ by Friday.', 'the invoice must be ____ by friday')).toBeGreaterThan(0.95);
    expect(trigramSimilarity('The invoice must be paid by Friday.', 'Our team meets every Monday morning.')).toBeLessThan(0.2);
  });

  it('tìm đúng các dòng trùng trong lô, giữ dòng đầu', () => {
    const stems = ['The quarterly report must be ______ by Friday.', 'Ms. Tran will be out of the office ______ next Wednesday.', 'The quarterly report must be ______ by Friday', 'Customers who register early are ______ to a discount.', 'ms tran will be out of the office ______ next wednesday'];
    const d = findBatchDuplicates(stems);
    expect(d.map((x) => [x.index, x.duplicate_of])).toEqual([
      [2, 0],
      [4, 1],
    ]);
  });
});
