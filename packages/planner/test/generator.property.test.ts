import { describe, it } from 'vitest';
import fc from 'fast-check';
import {
  MAX_DRILL_ROUNDS,
  WEEKDAYS,
  addDays,
  daysBetween,
  fromEpochDay,
  generatePlan,
  inventoryIndex,
  mandatoryMinutes,
  planWindows,
  taskRefIsReal,
  toEpochDay,
  validatePlan,
  weekdayOf,
  type ContentInventory,
  type PlanInput,
} from '../src/index.js';

/**
 * Property-based (fast-check, 500 ca – Sprint 9): MỌI lộ trình sinh ra từ đầu vào ngẫu nhiên hợp lệ phải thoả ràng buộc:
 * tổng phút ≤ ngân sách mỗi tuần (và dùng gần hết), task trỏ nội dung có thật, tuần cuối là mô phỏng (≥ 2 tuần: có full test
 * khi vừa ngân sách), mọi task đúng ngày học trong tuần, trong cửa sổ tuần, trước ngày thi.
 */
const NUM_RUNS = 500;
const id = (prefix: string, i: number) => `${prefix}-${i}`;

const inventoryArb: fc.Arbitrary<ContentInventory> = fc
  .record({
    sections: fc.uniqueArray(fc.integer({ min: 1, max: 7 }), { minLength: 1, maxLength: 7 }).chain((parts) =>
      fc.tuple(...parts.map((p) => fc.record({ p: fc.constant(p), q: fc.integer({ min: 0, max: 60 }), m: fc.integer({ min: 3, max: 15 }) }))),
    ),
    fulls: fc.array(fc.integer({ min: 30, max: 150 }), { maxLength: 3 }),
    minis: fc.array(fc.integer({ min: 5, max: 60 }), { maxLength: 3 }),
    lessons: fc.array(fc.record({ p: fc.integer({ min: 1, max: 7 }), m: fc.integer({ min: 5, max: 40 }), grammar: fc.boolean() }), { maxLength: 3 }),
    vocab: fc.boolean(),
  })
  .map((r) => ({
    sections: r.sections.map((s) => ({ id: id('sec', s.p), code: `part${s.p}`, skill: s.p <= 4 ? 'listening' : 'reading', name: { vi: `Part ${s.p}`, en: `Part ${s.p}` }, question_count: s.q, drill_minutes: s.m })),
    testSets: [
      ...r.fulls.map((m, i) => ({ id: id('full', i), code: `full-${i}`, kind: 'full' as const, title: { vi: `Đề ${i}`, en: `Test ${i}` }, minutes: m, question_count: 100, sections: ['part1'] })),
      ...r.minis.map((m, i) => ({ id: id('mini', i), code: `mini-${i}`, kind: 'mini' as const, title: { vi: `Mini ${i}`, en: `Mini ${i}` }, minutes: m, question_count: 30, sections: ['part5'] })),
    ],
    lessons: r.lessons.map((l, i) => ({ id: id('lesson', i), section_code: `part${l.p}`, kind: l.grammar ? ('grammar' as const) : ('lesson' as const), title: { vi: `Bài ${i}`, en: `Lesson ${i}` }, minutes: l.m })),
    vocabLists: r.vocab ? [{ id: 'vocab-0', title: { vi: 'Từ vựng', en: 'Vocabulary' } }] : [],
  }));

const inputArb: fc.Arbitrary<PlanInput> = fc
  .record({
    start: fc.integer({ min: toEpochDay('2026-01-01'), max: toEpochDay('2027-12-31') }),
    examOffset: fc.option(fc.integer({ min: 1, max: 220 }), { nil: null }),
    weeklyMinutes: fc.integer({ min: 60, max: 2100 }),
    studyDays: fc.subarray([...WEEKDAYS], { minLength: 1 }),
    isPro: fc.boolean(),
    inventory: inventoryArb,
    mastery: fc.array(fc.record({ sub: fc.integer({ min: 1, max: 12 }), parts: fc.uniqueArray(fc.integer({ min: 1, max: 7 }), { minLength: 1, maxLength: 3 }), m: fc.double({ min: 0, max: 1, noNaN: true }) }), { maxLength: 12 }),
  })
  .map((r) => ({
    program: 'toeic',
    startDate: fromEpochDay(r.start),
    examDate: r.examOffset === null ? null : fromEpochDay(r.start + r.examOffset),
    weeklyMinutes: r.weeklyMinutes,
    studyDays: r.studyDays,
    isPro: r.isPro,
    inventory: r.inventory,
    mastery: r.mastery.map((m) => ({ subskill: `sub${m.sub}`, skill: 'reading', sections: m.parts.map((p) => `part${p}`), mastery: m.m })),
  }));

describe('PlanGenerator – property-based (500 ca)', () => {
  it('validatePlan không có vi phạm cho mọi đầu vào', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const plan = generatePlan(input);
        const v = validatePlan(plan, input);
        if (v.length) throw new Error(JSON.stringify(v.slice(0, 3)));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('tổng phút ≤ ngân sách và dùng gần hết ngân sách (phần dư < một task luyện); tổng ngân sách ≤ phút/tuần × số tuần', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const plan = generatePlan(input);
        const drills = input.inventory.sections.filter((s) => s.question_count > 0).map((s) => s.drill_minutes);
        const hasVocab = input.inventory.vocabLists.length > 0;
        let budgets = 0;
        for (const w of plan.weeks) {
          const sum = w.tasks.reduce((a, t) => a + t.est_minutes, 0);
          if (sum > w.budget_minutes) return false;
          budgets += w.budget_minutes;
          if (drills.length && w.study_dates.length && w.budget_minutes >= mandatoryMinutes(w.study_dates.length, hasVocab) && w.budget_minutes - sum >= Math.min(...drills) * MAX_DRILL_ROUNDS) return false;
        }
        return budgets <= input.weeklyMinutes * plan.weeks.length;
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('mọi task trỏ nội dung có thật (test set / section có câu / lesson / vocab list), checkin không có ref', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const idx = inventoryIndex(input.inventory);
        return generatePlan(input).weeks.every((w) => w.tasks.every((t) => taskRefIsReal(t, idx)));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('tuần cuối là mô phỏng; ≥ 2 tuần và có đề full vừa ngân sách → tuần cuối có full test; ≤ 1 full test/tuần; full test cách nhau ≥ nhịp', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const plan = generatePlan(input);
        const last = plan.weeks[plan.weeks.length - 1]!;
        if (last.phase !== 'simulation') return false;
        const room = last.budget_minutes - mandatoryMinutes(last.study_dates.length, input.inventory.vocabLists.length > 0);
        const fits = input.inventory.testSets.some((t) => t.kind === 'full' && t.minutes <= room);
        if (plan.weeks.length >= 2 && fits && !last.tasks.some((t) => t.task_type === 'full_test')) return false;
        if (plan.weeks.some((w) => w.tasks.filter((t) => t.task_type === 'full_test').length > 1)) return false;
        const fullWeeks = plan.weeks.filter((w) => w.tasks.some((t) => t.task_type === 'full_test')).map((w) => w.week_no);
        for (let i = 1; i < fullWeeks.length; i++) if (fullWeeks[i]! - fullWeeks[i - 1]! < plan.strategy.full_test_every_weeks) return false;
        return true;
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('đúng ngày học trong tuần, trong cửa sổ tuần, từ hôm nay tới trước ngày thi; số tuần đúng theo ngày thi', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const plan = generatePlan(input);
        const { windows, anchored } = planWindows(input);
        if (plan.weeks.length !== windows.length) return false;
        if (anchored && input.examDate) {
          if (plan.weeks.length !== Math.ceil(daysBetween(input.startDate, input.examDate) / 7)) return false;
          if (plan.weeks[plan.weeks.length - 1]!.end_date !== addDays(input.examDate, -1)) return false;
        }
        const days = new Set(input.studyDays);
        return plan.weeks.every(
          (w) =>
            daysBetween(w.start_date, w.end_date) <= 6 &&
            w.tasks.every((t) => days.has(weekdayOf(t.due_date)) && t.due_date >= w.start_date && t.due_date <= w.end_date && t.due_date >= input.startDate && (!input.examDate || t.due_date < input.examDate)),
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
