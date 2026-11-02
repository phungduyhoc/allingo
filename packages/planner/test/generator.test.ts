import { describe, expect, it } from 'vitest';
import { FULL_TEST_EVERY_WEEKS, addDays, fullTestWeeks, generatePlan, planWindows, validatePlan, weekdayOf, type PlanInput } from '../src/index.js';
import { MASTERY, TOEIC_INVENTORY } from './fixtures.js';

const base: PlanInput = {
  program: 'toeic',
  startDate: '2026-11-02', // thứ Hai
  examDate: '2026-12-28', // thứ Hai, 8 tuần sau
  weeklyMinutes: 300,
  studyDays: ['mon', 'tue', 'wed', 'thu', 'sat'],
  isPro: true,
  mastery: MASTERY,
  inventory: TOEIC_INVENTORY,
};

describe('PlanGenerator – ví dụ TOEIC demo', () => {
  const plan = generatePlan(base);

  it('8 tuần neo vào ngày thi, tuần cuối là 7 ngày trước ngày thi; không vi phạm ràng buộc', () => {
    expect(plan.weeks).toHaveLength(8);
    expect(plan.strategy.anchored_to_exam).toBe(true);
    expect(plan.weeks[0]!.start_date).toBe('2026-11-02');
    expect(plan.weeks[7]!.end_date).toBe('2026-12-27');
    expect(plan.weeks[7]!.start_date).toBe('2026-12-21');
    expect(validatePlan(plan, base)).toEqual([]);
  });

  it('phút/tuần đúng cài đặt: tuần đầy đủ có ngân sách 300 và dùng gần hết (dư < 1 lượt luyện)', () => {
    for (const w of plan.weeks) {
      expect(w.budget_minutes).toBe(300);
      expect(w.load_minutes).toBeLessThanOrEqual(300);
      expect(300 - w.load_minutes).toBeLessThan(5);
    }
  });

  it('chu kỳ nền → luyện → mô phỏng, tuần cuối mô phỏng có full test L&R; Pro full test tuần 2,4,6,8', () => {
    expect(plan.strategy.phases).toEqual(['foundation', 'practice', 'simulation', 'foundation', 'practice', 'simulation', 'foundation', 'simulation']);
    expect(plan.weeks.filter((w) => w.has_full_test).map((w) => w.week_no)).toEqual([2, 4, 6, 8]);
    const last = plan.weeks[7]!;
    const ft = last.tasks.find((t) => t.task_type === 'full_test')!;
    expect(ft.ref_id).toBe(TOEIC_INVENTORY.testSets[0]!.id);
    expect(ft.evidence.code).toBe('final_simulation');
  });

  it('Free: full test 1 lần/4 tuần (tuần 4, 8)', () => {
    const free = generatePlan({ ...base, isPro: false });
    expect(free.weeks.filter((w) => w.has_full_test).map((w) => w.week_no)).toEqual([4, 8]);
    expect(FULL_TEST_EVERY_WEEKS.free).toBe(4);
    expect([...fullTestWeeks(5, 4)].sort()).toEqual([1, 5]);
  });

  it('Part yếu (Part 5, mastery 0,2) nhận nhiều phút luyện hơn Part mạnh (Part 2, mastery 0,9)', () => {
    const minutes = (code: string) => plan.weeks.flatMap((w) => w.tasks).filter((t) => t.ref_type === 'section' && t.ref_id === TOEIC_INVENTORY.sections.find((s) => s.code === code)!.id).reduce((a, t) => a + t.est_minutes, 0);
    expect(minutes('part5')).toBeGreaterThan(minutes('part2'));
    expect(plan.strategy.focus_rotation[0]).toBe('part5');
  });

  it('ôn từ vựng mỗi ngày học, điểm danh ngày học cuối tuần, tuần nền có bài ngữ pháp', () => {
    for (const w of plan.weeks) {
      for (const d of w.study_dates) expect(w.tasks.some((t) => t.task_type === 'vocab_review' && t.due_date === d)).toBe(true);
      const checkin = w.tasks.find((t) => t.task_type === 'checkin')!;
      expect(checkin.due_date).toBe(w.study_dates[w.study_dates.length - 1]);
      expect(weekdayOf(checkin.due_date)).toBe('sat');
    }
    expect(plan.weeks[0]!.tasks.some((t) => t.task_type === 'grammar' && t.ref_type === 'lesson')).toBe(true);
  });

  it('mọi task đúng ngày học (không giao chủ nhật/thứ sáu)', () => {
    for (const t of plan.weeks.flatMap((w) => w.tasks)) expect(['mon', 'tue', 'wed', 'thu', 'sat']).toContain(weekdayOf(t.due_date));
  });

  it('tuần đầu thiếu ngày → ngân sách theo tỉ lệ ngày học; không có ngày thi → 8 tuần từ hôm nay', () => {
    const p = generatePlan({ ...base, startDate: '2026-11-05' }); // thứ Năm
    const w1 = p.weeks[0]!;
    expect(w1.start_date).toBe('2026-11-05');
    expect(w1.study_dates).toEqual(['2026-11-05', '2026-11-07']);
    expect(w1.budget_minutes).toBe(120);
    expect(validatePlan(p, { ...base, startDate: '2026-11-05' })).toEqual([]);
    const noExam = planWindows({ startDate: '2026-11-05', examDate: null });
    expect(noExam.windows).toHaveLength(8);
    expect(noExam.windows[7]!.end).toBe(addDays('2026-11-05', 55));
  });

  it('ngân sách nhỏ (120′/tuần): tuần cuối vẫn có full test vừa ngân sách (Listening 45′ hoặc Reading 75′)', () => {
    const small = { ...base, weeklyMinutes: 120 };
    const p = generatePlan(small);
    expect(validatePlan(p, small)).toEqual([]);
    const ft = p.weeks[7]!.tasks.find((t) => t.task_type === 'full_test')!;
    expect(ft.est_minutes).toBeLessThanOrEqual(120 - 5 - 5 * 5);
  });

  it('xác định: cùng đầu vào → cùng kết quả', () => {
    expect(generatePlan(base)).toEqual(generatePlan(base));
  });
});
