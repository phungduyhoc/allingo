import { addDays, daysBetween, maxIso, weekdayOf } from './dates.js';
import {
  type ContentInventory,
  type GeneratedPlan,
  type InventorySection,
  type InventoryTestSet,
  type LocalizedTitle,
  type MasteryRow,
  type PlanInput,
  type PlanPhase,
  type PlannedTask,
  type PlannedWeek,
  type PlanTaskType,
  type TaskEvidence,
  type Weekday,
  PLAN_PHASES,
} from './types.js';

/**
 * PlanGenerator v1 (ADR-0032) – thuật toán thuần, không AI:
 * 1. Chia thời gian tới ngày thi thành tuần 7 ngày NEO VÀO NGÀY THI (tuần cuối = 7 ngày trước ngày thi; tuần đầu có thể thiếu
 *    ngày). Không có ngày thi (hoặc quá `maxWeeks`) → tuần tính từ hôm nay, `defaultWeeks` tuần.
 * 2. Pha theo chu kỳ 3 tuần nền → luyện → mô phỏng; tuần cuối LUÔN là mô phỏng.
 * 3. Ngân sách phút mỗi tuần = phút/tuần × (ngày học có trong tuần ÷ ngày học/tuần) – không bao giờ vượt.
 * 4. Việc bắt buộc: ôn từ vựng mỗi ngày học (5′), điểm danh ngày học cuối tuần (5′), full test theo nhịp đếm ngược từ tuần
 *    cuối (Pro 2 tuần, Free 4 tuần) – tuần cuối luôn có full test nếu vừa ngân sách. Tuần mô phỏng không có full test → đề mini.
 * 5. Phần còn lại chia thành lượt luyện 10 câu theo Part: Part yếu hơn (mastery thấp) nhận nhiều lượt hơn (chia theo
 *    trọng số giảm dần kiểu D'Hondt), Part trọng tâm của tuần ×1,5; tuần nền thêm một bài học/ngữ pháp của Part yếu.
 * 6. Mọi task trỏ nội dung có thật trong `inventory` (test set / section / lesson / vocab list).
 */

export const DEFAULT_WEEKS = 8;
export const MAX_WEEKS = 26;
export const VOCAB_REVIEW_MINUTES = 5;
export const CHECKIN_MINUTES = 5;
/** S10: ôn sổ lỗi (10 lỗi chưa hiểu cũ nhất) – một lần/tuần từ tuần 2, ngày học giữa tuần */
export const REVIEW_ERRORS_MINUTES = 10;
export const MIN_WEEKLY_MINUTES = 60;
export const MAX_WEEKLY_MINUTES = 2100;
export const PLAN_CYCLE: readonly PlanPhase[] = PLAN_PHASES;
export const FULL_TEST_EVERY_WEEKS = { pro: 2, free: 4 } as const;
/** Trên ngưỡng này mỗi task luyện gộp nhiều lượt 10 câu (tối đa 4) để một ngày không quá nhiều việc */
export const MAX_PRACTICE_TASKS_PER_DAY = 8;
export const MAX_DRILL_ROUNDS = 4;
/** Trọng số sàn của một Part (Part mạnh vẫn được ôn) */
export const SECTION_WEIGHT_FLOOR = 0.15;
export const FOCUS_BOOST = 1.5;

export interface WeekWindow {
  week_no: number;
  start: string;
  /** bao gồm */
  end: string;
}

/** Cửa sổ các tuần của lộ trình */
export function planWindows(input: Pick<PlanInput, 'startDate' | 'examDate' | 'defaultWeeks' | 'maxWeeks'>): { windows: WeekWindow[]; anchored: boolean } {
  const maxWeeks = input.maxWeeks ?? MAX_WEEKS;
  const start = input.startDate;
  const total = input.examDate ? daysBetween(start, input.examDate) : 0;
  if (input.examDate && total >= 1 && total <= maxWeeks * 7) {
    const n = Math.ceil(total / 7);
    const lastDay = addDays(input.examDate, -1);
    const windows: WeekWindow[] = [];
    for (let k = 1; k <= n; k++) {
      const end = addDays(lastDay, -7 * (n - k));
      windows.push({ week_no: k, start: maxIso(start, addDays(end, -6)), end });
    }
    return { windows, anchored: true };
  }
  const n = input.examDate && total > maxWeeks * 7 ? maxWeeks : (input.defaultWeeks ?? DEFAULT_WEEKS);
  return { windows: Array.from({ length: n }, (_, i) => ({ week_no: i + 1, start: addDays(start, 7 * i), end: addDays(start, 7 * i + 6) })), anchored: false };
}

export function studyDatesIn(w: WeekWindow, studyDays: readonly Weekday[]): string[] {
  const out: string[] = [];
  for (let d = 0; d <= daysBetween(w.start, w.end); d++) {
    const iso = addDays(w.start, d);
    if (studyDays.includes(weekdayOf(iso))) out.push(iso);
  }
  return out;
}

/** Ngân sách phút của một tuần (làm tròn xuống) */
export function weekBudget(weeklyMinutes: number, studyDatesInWeek: number, studyDaysPerWeek: number): number {
  if (studyDaysPerWeek <= 0 || studyDatesInWeek <= 0) return 0;
  return Math.floor((weeklyMinutes * Math.min(studyDatesInWeek, studyDaysPerWeek)) / studyDaysPerWeek);
}

/** Phút bắt buộc (ôn từ vựng mỗi ngày + điểm danh) của tuần có `days` ngày học */
export function mandatoryMinutes(days: number, hasVocab: boolean): number {
  if (days <= 0) return 0;
  return CHECKIN_MINUTES + (hasVocab ? days * VOCAB_REVIEW_MINUTES : 0);
}

/** Trọng số theo Part: sàn + trung bình (1 − mastery) các subskill đo ở Part đó (chưa có dữ liệu → 0,5) */
export function sectionWeights(sections: readonly InventorySection[], mastery: readonly MasteryRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of sections) {
    const rows = mastery.filter((m) => m.sections.includes(s.code));
    const weakness = rows.length ? rows.reduce((a, m) => a + (1 - Math.max(0, Math.min(1, m.mastery))), 0) / rows.length : 0.5;
    out[s.code] = Math.round((SECTION_WEIGHT_FLOOR + weakness) * 10_000) / 10_000;
  }
  return out;
}

/** Tuần có full test: đếm ngược từ tuần cuối theo nhịp (vd N=8, Pro: 8,6,4,2; Free: 8,4) */
export function fullTestWeeks(n: number, cadence: number): Set<number> {
  const out = new Set<number>();
  for (let w = n; w >= 1; w -= cadence) out.add(w);
  return out;
}

export function phaseOf(weekNo: number, totalWeeks: number): PlanPhase {
  return weekNo === totalWeeks ? 'simulation' : PLAN_CYCLE[(weekNo - 1) % PLAN_CYCLE.length]!;
}

const TYPE_ORDER: Record<PlanTaskType, number> = { vocab_review: 0, lesson: 1, grammar: 1, part_drill: 2, timed_drill: 3, review_errors: 3, dictation: 3, shadowing: 3, writing: 3, speaking: 3, impromptu: 3, full_test: 4, checkin: 5 };

const t = (vi: string, en: string): LocalizedTitle => ({ vi, en });

function pickLargestFitting(list: readonly InventoryTestSet[], maxMinutes: number): InventoryTestSet | null {
  return [...list].filter((x) => x.minutes > 0 && x.minutes <= maxMinutes).sort((a, b) => b.minutes - a.minutes || a.code.localeCompare(b.code))[0] ?? null;
}

interface Unit {
  section: InventorySection;
  minutes: number;
  rounds: number;
}

/** Chia `remaining` phút thành lượt luyện theo trọng số giảm dần (Part yếu nhận trước, lặp lại có giảm dần) */
export function allocateDrills(sections: readonly InventorySection[], weights: Record<string, number>, remaining: number, rounds: number): Unit[] {
  const counts = new Map<string, number>();
  const units: Unit[] = [];
  let left = remaining;
  for (;;) {
    let best: InventorySection | null = null;
    let bestScore = -1;
    for (const s of sections) {
      const minutes = s.drill_minutes * rounds;
      if (minutes > left) continue;
      const score = (weights[s.code] ?? SECTION_WEIGHT_FLOOR) / (1 + (counts.get(s.code) ?? 0));
      if (score > bestScore + 1e-9) {
        best = s;
        bestScore = score;
      }
    }
    if (!best) break;
    counts.set(best.code, (counts.get(best.code) ?? 0) + 1);
    units.push({ section: best, minutes: best.drill_minutes * rounds, rounds });
    left -= best.drill_minutes * rounds;
  }
  return units;
}

export function generatePlan(input: PlanInput): GeneratedPlan {
  const inv: ContentInventory = input.inventory;
  const studyDays = [...new Set(input.studyDays)];
  const { windows, anchored } = planWindows(input);
  const n = windows.length;
  const cadence = input.isPro ? FULL_TEST_EVERY_WEEKS.pro : FULL_TEST_EVERY_WEEKS.free;
  const fullWeeks = fullTestWeeks(n, cadence);
  const sections = inv.sections.filter((s) => s.question_count > 0 && s.drill_minutes > 0);
  const weights = sectionWeights(sections, input.mastery);
  const rotation = [...sections]
    .sort((a, b) => (weights[b.code] ?? 0) - (weights[a.code] ?? 0) || a.code.localeCompare(b.code))
    .slice(0, Math.min(3, sections.length))
    .map((s) => s.code);
  const vocab = inv.vocabLists[0] ?? null;
  const fulls = inv.testSets.filter((x) => x.kind === 'full');
  const minis = inv.testSets.filter((x) => x.kind === 'mini');
  const minutesPerSkill: Record<string, number> = {};
  const bump = (k: string, m: number) => (minutesPerSkill[k] = (minutesPerSkill[k] ?? 0) + m);

  const weeks: PlannedWeek[] = windows.map((w) => {
    const phase = phaseOf(w.week_no, n);
    const dates = studyDatesIn(w, studyDays);
    const budget = weekBudget(input.weeklyMinutes, dates.length, studyDays.length);
    const tasks: PlannedTask[] = [];
    const dayLoad = new Map(dates.map((d) => [d, 0]));
    let used = 0;
    const add = (task: PlannedTask) => {
      tasks.push(task);
      used += task.est_minutes;
      dayLoad.set(task.due_date, (dayLoad.get(task.due_date) ?? 0) + task.est_minutes);
    };
    const leastLoaded = () => [...dayLoad.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))[0]![0];
    const focusCode = rotation.length ? rotation[(w.week_no - 1) % rotation.length]! : null;
    const focus = sections.find((s) => s.code === focusCode) ?? null;
    let hasFull = false;

    if (dates.length && budget > 0) {
      const last = dates[dates.length - 1]!;
      const mockDate = dates.length >= 2 ? dates[dates.length - 2]! : last;
      // 1) điểm danh cuối tuần
      if (budget - used >= CHECKIN_MINUTES) add({ due_date: last, task_type: 'checkin', ref_type: null, ref_id: null, title: t('Điểm danh tuần', 'Weekly check-in'), est_minutes: CHECKIN_MINUTES, evidence: { code: 'weekly_checkin', params: { week_no: w.week_no } } });
      // 2) ôn từ vựng mỗi ngày học
      if (vocab)
        for (const d of dates) {
          if (budget - used < VOCAB_REVIEW_MINUTES) break;
          add({ due_date: d, task_type: 'vocab_review', ref_type: 'vocab_list', ref_id: vocab.id, title: t(`Ôn từ vựng: ${vocab.title.vi}`, `Vocabulary review: ${vocab.title.en}`), est_minutes: VOCAB_REVIEW_MINUTES, evidence: { code: 'daily_vocab', params: {} } });
          bump('vocabulary', VOCAB_REVIEW_MINUTES);
        }
      // 3) full test theo nhịp
      if (fullWeeks.has(w.week_no)) {
        const ft = pickLargestFitting(fulls, budget - used);
        if (ft) {
          add({ due_date: mockDate, task_type: 'full_test', ref_type: 'test_set', ref_id: ft.id, title: ft.title, est_minutes: ft.minutes, evidence: { code: w.week_no === n ? 'final_simulation' : 'cadence_full_test', params: { every_weeks: cadence } } });
          bump('full_test', ft.minutes);
          hasFull = true;
        }
      }
      // 3b) S10: ôn sổ lỗi giữa tuần (từ tuần 2 – đã có bài làm), không trỏ nội dung catalog (ref null)
      if (input.reviewErrors !== false && w.week_no >= 2 && dates.length >= 2 && budget - used >= REVIEW_ERRORS_MINUTES + CHECKIN_MINUTES) {
        const mid = dates[Math.floor((dates.length - 1) / 2)]!;
        add({ due_date: mid, task_type: 'review_errors', ref_type: null, ref_id: null, title: t('Ôn sổ lỗi – 10 lỗi chưa hiểu', 'Review your error log – 10 open mistakes'), est_minutes: REVIEW_ERRORS_MINUTES, evidence: { code: 'review_errors', params: { count: 10 } } });
        bump('review_errors', REVIEW_ERRORS_MINUTES);
      }
      // 4) tuần mô phỏng không có full test → đề mini tính giờ
      if (phase === 'simulation' && !hasFull) {
        const mini = pickLargestFitting(minis, budget - used);
        if (mini) {
          add({ due_date: mockDate, task_type: 'timed_drill', ref_type: 'test_set', ref_id: mini.id, title: mini.title, est_minutes: mini.minutes, evidence: { code: 'simulation_mini', params: {} } });
          bump('full_test', mini.minutes);
        }
      }
      // 5) tuần nền: một bài học/ngữ pháp của Part yếu nhất có bài học
      if (phase === 'foundation') {
        const order = [...(focusCode ? [focusCode] : []), ...rotation, ...sections.map((s) => s.code)];
        const lesson = order.map((code) => inv.lessons.find((l) => l.section_code === code && l.minutes > 0 && l.minutes <= budget - used)).find(Boolean) ?? null;
        if (lesson) {
          const sec = sections.find((s) => s.code === lesson.section_code);
          add({ due_date: leastLoaded(), task_type: lesson.kind === 'grammar' ? 'grammar' : 'lesson', ref_type: 'lesson', ref_id: lesson.id, title: lesson.title, est_minutes: lesson.minutes, evidence: { code: 'foundation_lesson', params: { section: lesson.section_code ?? '' } } });
          bump(sec?.skill ?? 'lesson', lesson.minutes);
        }
      }
      // 6) lượt luyện theo điểm yếu
      const remaining = budget - used;
      if (sections.length && remaining > 0) {
        const avgUnit = sections.reduce((a, s) => a + s.drill_minutes, 0) / sections.length;
        const rounds = Math.max(1, Math.min(MAX_DRILL_ROUNDS, Math.ceil(remaining / (dates.length * MAX_PRACTICE_TASKS_PER_DAY * avgUnit))));
        const wk = { ...weights };
        if (focusCode) wk[focusCode] = (wk[focusCode] ?? SECTION_WEIGHT_FLOOR) * FOCUS_BOOST;
        const units = allocateDrills(sections, wk, remaining, rounds);
        // Phần dư nhỏ hơn một task gộp → lấp bằng lượt 10 câu đơn
        if (rounds > 1) units.push(...allocateDrills(sections, wk, remaining - units.reduce((a, u) => a + u.minutes, 0), 1));
        let timedGiven = false;
        for (const u of [...units].sort((a, b) => b.minutes - a.minutes || a.section.code.localeCompare(b.section.code))) {
          const timed = phase === 'simulation' || (phase === 'practice' && !timedGiven && u.section.code === focusCode);
          if (timed && phase === 'practice') timedGiven = true;
          const q = 10 * u.rounds;
          const isFocus = u.section.code === focusCode;
          const evidence: TaskEvidence = { code: isFocus ? 'focus_section' : 'weak_section', params: { section: u.section.code, weight: weights[u.section.code] ?? 0, questions: q } };
          add({
            due_date: leastLoaded(),
            task_type: timed ? 'timed_drill' : 'part_drill',
            ref_type: 'section',
            ref_id: u.section.id,
            title: timed ? t(`Luyện tính giờ ${u.section.name.vi} – ${q} câu`, `Timed drill ${u.section.name.en} – ${q} questions`) : t(`Luyện ${u.section.name.vi} – ${q} câu`, `Practice ${u.section.name.en} – ${q} questions`),
            est_minutes: u.minutes,
            evidence,
          });
          bump(u.section.skill, u.minutes);
        }
      }
    }
    tasks.sort((a, b) => a.due_date.localeCompare(b.due_date) || TYPE_ORDER[a.task_type] - TYPE_ORDER[b.task_type]);
    return {
      week_no: w.week_no,
      start_date: w.start,
      end_date: w.end,
      phase,
      focus_section: focus?.code ?? null,
      focus_skill: focus?.skill ?? null,
      budget_minutes: budget,
      load_minutes: used,
      study_dates: dates,
      has_full_test: hasFull,
      tasks,
    };
  });

  return {
    weeks,
    strategy: {
      generator: 'rule-v1',
      weeks: n,
      cycle: PLAN_CYCLE,
      phases: weeks.map((w) => w.phase),
      full_test_every_weeks: cadence,
      focus_rotation: rotation,
      minutes_per_skill: minutesPerSkill,
      section_weights: weights,
      anchored_to_exam: anchored,
    },
  };
}
