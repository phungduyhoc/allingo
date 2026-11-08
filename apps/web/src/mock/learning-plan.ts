import {
  WEEKDAY_CODES,
  XP_TABLE,
  levelForXp,
  planCheckinInputSchema,
  planCreateInputSchema,
  planTaskPatchSchema,
  type Attempt,
  type AttemptMode,
  type Badge,
  type DiagnosticResult,
  type DiagnosticStep,
  type PlanAdjustProposal,
  type PlanTask,
  type PlanToday,
  type PlanWeek,
  type Stats,
  type StudyPlan,
} from '@allingo/schemas';
import { TOEIC_PART_SKILL, buildDiagnosticPool, diagnosticAdvance, estimateToeicDiagnostic, initDiagnosticState, masteryFromDiagnostic, suggestToeicTarget, type DiagnosticItem, type DiagnosticState } from '@allingo/scoring';
import { emitTo, notify } from './billing-core';
import type { MockHandler, MockRouteDef } from './billing';
import { FULL_TEST_LOCKED, LR_MINI, MOCK_SUBSKILL_OF_TAG, type MockQuestion } from './fixtures';
import { MOCK_DIAGNOSTIC_BLUEPRINT, MOCK_DIAGNOSTIC_DIFFICULTY, MOCK_DIAGNOSTIC_QUESTIONS, MOCK_DIAGNOSTIC_SET } from './diagnostic-fixtures';
import { MOCK_DICTIONARY } from './dictionary';
import type { MockAttemptRecord, MockPlanRecord, MockPlanTaskRecord, MockPlanWeekRecord, MockProposalRecord, MockState, MockStreakRecord, MockUserRecord } from './state';

/**
 * "Máy chủ" giả lập Sprint 9 (chỉ dev/E2E): bài chẩn đoán thích ứng (luật 2 đúng/2 sai của @allingo/scoring trên ngân hàng mock
 * 23 câu), lộ trình tuần (bộ sinh đơn giản bám ADR-0032: neo ngày thi / 8 tuần, nền → luyện → mô phỏng, ôn từ mỗi ngày học,
 * điểm danh cuối tuần, full test theo nhịp gói, lượt luyện theo Part yếu), hôm nay + gợi ý 15 phút, PATCH task (luật đổi ngày như
 * API), check-in → đề xuất `pending` → `ready` sau ~1 s (realtime `plan.updated` + thông báo `learning.plan_adjust_ready`), câu
 * lệnh tự nhiên (credit), áp dụng, chuỗi ngày theo múi giờ (đóng băng Pro), XP, huy hiệu (rule seed như API) + thông báo.
 */

export interface LearningPlanDeps {
  state: MockState;
  persist: () => void;
  route: (method: string, path: string, handler: MockHandler) => MockRouteDef;
  json: (status: number, body: unknown, headers?: Record<string, string>) => Response;
  error: (status: number, code: string, message: string, details?: Record<string, unknown>) => Response;
  uuid: () => string;
  nowIso: () => string;
  requireUser: () => MockUserRecord | Response;
  isPro: (u: MockUserRecord) => boolean;
  publicQuestion: (q: MockQuestion) => Attempt['questions'][number];
  /** Chấm + ghi kết quả attempt (gradeAttempt của mock-fetch; cộng XP bài làm) */
  finishAttempt: (a: MockAttemptRecord) => void;
  /** Câu của Part từ mọi đề mock (không gồm ngân hàng chẩn đoán) */
  sectionQuestions: (sectionCode: string) => MockQuestion[];
  toAttemptDto: (a: MockAttemptRecord) => Attempt;
  quotaExceeded: (u: MockUserRecord, feature: string) => Response | null;
  consumeQuota: (u: MockUserRecord, feature: string) => void;
}

const DAY_MS = 86_400_000;
const uid = (n: number, prefix: string) => `${prefix}0000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// ----------------------------------------------------------------------------- nội dung lộ trình (mock catalog)
export const MOCK_PLAN_SECTIONS = [
  { code: 'part1', skill: 'listening', id: uid(901, '5ec7'), name: { vi: 'Part 1 – Mô tả tranh', en: 'Part 1 – Photographs' }, minutes: 6 },
  { code: 'part2', skill: 'listening', id: uid(902, '5ec7'), name: { vi: 'Part 2 – Hỏi đáp', en: 'Part 2 – Question–Response' }, minutes: 5 },
  { code: 'part3', skill: 'listening', id: uid(903, '5ec7'), name: { vi: 'Part 3 – Hội thoại', en: 'Part 3 – Conversations' }, minutes: 8 },
  { code: 'part4', skill: 'listening', id: uid(904, '5ec7'), name: { vi: 'Part 4 – Bài nói ngắn', en: 'Part 4 – Talks' }, minutes: 8 },
  { code: 'part5', skill: 'reading', id: uid(905, '5ec7'), name: { vi: 'Part 5 – Hoàn thành câu', en: 'Part 5 – Incomplete Sentences' }, minutes: 7 },
  { code: 'part6', skill: 'reading', id: uid(906, '5ec7'), name: { vi: 'Part 6 – Hoàn thành đoạn văn', en: 'Part 6 – Text Completion' }, minutes: 10 },
  { code: 'part7', skill: 'reading', id: uid(907, '5ec7'), name: { vi: 'Part 7 – Đọc hiểu', en: 'Part 7 – Reading Comprehension' }, minutes: 12 },
] as const;

export const MOCK_LESSON = {
  id: uid(950, '1e55'),
  program: 'toeic',
  kind: 'grammar',
  section_code: 'part5',
  title: { vi: 'Part 5: Nhận diện thì qua dấu hiệu thời gian', en: 'Part 5: Spotting tenses from time markers' },
  summary: { vi: 'Ba bước đọc dấu hiệu thời gian để chọn thì đúng trong 10 giây.', en: 'A three-step routine to pick the right tense in 10 seconds.' },
  est_minutes: 12,
  is_free: true,
  steps: [
    { step_no: 1, type: 'text', content: { vi: '## Bước 1 – Tìm mốc thời gian\nCác từ như *yesterday, next Monday, by the time, since 2019* quyết định thì của động từ.', en: '## Step 1 – Find the time marker\nWords such as *yesterday, next Monday, by the time, since 2019* decide the tense.' } },
    { step_no: 2, type: 'text', content: { vi: '## Bước 2 – Ghép dấu hiệu với thì\n- next/tomorrow → tương lai\n- by the time + hiện tại → tương lai hoàn thành\n- since/for → hiện tại hoàn thành', en: '## Step 2 – Map marker → tense\n- next/tomorrow → future\n- by the time + present → future perfect\n- since/for → present perfect' } },
    { step_no: 3, type: 'text', content: { vi: '## Bước 3 – Kiểm tra chủ ngữ\nSau khi chọn thì, kiểm tra số ít/số nhiều và thể bị động.', en: '## Step 3 – Check the subject\nAfter choosing the tense, check agreement and passive voice.' } },
  ],
};

export const MOCK_VOCAB_LIST = { id: uid(960, '70ca'), title: { vi: 'TOEIC 10 từ văn phòng cơ bản', en: 'TOEIC 10 essential office words' } };

/** Huy hiệu seed như API (learn.badges) */
const BADGES: { code: string; name: { vi: string; en: string }; rule: Record<string, unknown> }[] = [
  { code: 'first_attempt', name: { vi: 'Bài đầu tiên', en: 'First attempt' }, rule: { event: 'attempt.graded', count: 1 } },
  { code: 'first_full_test', name: { vi: 'Đề thi thử đầu tiên', en: 'First full test' }, rule: { event: 'attempt.graded', kind: 'full', count: 1 } },
  { code: 'questions_1000', name: { vi: '1.000 câu hỏi', en: '1,000 questions' }, rule: { answered: 1000 } },
  { code: 'score_up_50', name: { vi: 'Tăng 50 điểm', en: '+50 points' }, rule: { score_delta: 50 } },
  { code: 'streak_30', name: { vi: '30 ngày liên tiếp', en: '30-day streak' }, rule: { streak: 30 } },
  { code: 'streak_7', name: { vi: '7 ngày liên tiếp', en: '7-day streak' }, rule: { streak: 7 } },
];

// ----------------------------------------------------------------------------- ngày theo múi giờ
export function localDate(tz: string, now = Date.now()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now));
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    return new Date(now).toISOString().slice(0, 10);
  }
}
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
const weekdayOf = (iso: string) => WEEKDAY_CODES[(new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7]!;
const isValidTz = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

// ----------------------------------------------------------------------------- bộ sinh lộ trình (đơn giản hoá ADR-0032)
interface GenInput {
  startDate: string;
  examDate: string | null;
  weeklyMinutes: number;
  studyDays: string[];
  isPro: boolean;
  /** section → mastery 0–1 (thiếu = 0,5) */
  mastery: Record<string, number>;
}

export function mockGeneratePlan(inp: GenInput, uuid: () => string): Pick<MockPlanRecord, 'weeks' | 'tasks' | 'full_test_every_weeks' | 'minutes_per_skill'> {
  const total = inp.examDate ? daysBetween(inp.startDate, inp.examDate) : 0;
  let windows: { start: string; end: string }[];
  if (inp.examDate && total >= 1 && total <= 52 * 7) {
    const n = Math.ceil(total / 7);
    const lastDay = addDays(inp.examDate, -1);
    windows = Array.from({ length: n }, (_, i) => {
      const end = addDays(lastDay, -7 * (n - 1 - i));
      const start = addDays(end, -6) < inp.startDate ? inp.startDate : addDays(end, -6);
      return { start, end };
    });
  } else {
    windows = Array.from({ length: 8 }, (_, i) => ({ start: addDays(inp.startDate, 7 * i), end: addDays(inp.startDate, 7 * i + 6) }));
  }
  const n = windows.length;
  const cadence = inp.isPro ? 2 : 4;
  const fullWeeks = new Set<number>();
  for (let w = n; w >= 1; w -= cadence) fullWeeks.add(w);
  const ranked = [...MOCK_PLAN_SECTIONS].sort((a, b) => (inp.mastery[a.code] ?? 0.5) - (inp.mastery[b.code] ?? 0.5) || a.code.localeCompare(b.code));
  const weeks: MockPlanWeekRecord[] = [];
  const tasks: MockPlanTaskRecord[] = [];
  const perSkill: Record<string, number> = {};
  const bump = (k: string, m: number) => (perSkill[k] = (perSkill[k] ?? 0) + m);
  windows.forEach((win, i) => {
    const week_no = i + 1;
    const phase: MockPlanWeekRecord['phase'] = week_no === n ? 'simulation' : (['foundation', 'practice', 'simulation'] as const)[i % 3]!;
    const dates: string[] = [];
    for (let d = 0; d <= daysBetween(win.start, win.end); d++) {
      const iso = addDays(win.start, d);
      if (inp.studyDays.includes(weekdayOf(iso))) dates.push(iso);
    }
    const budget = Math.floor((inp.weeklyMinutes * dates.length) / Math.max(1, inp.studyDays.length));
    const focus = ranked[i % ranked.length]!;
    const weekId = uuid();
    weeks.push({ id: weekId, week_no, start_date: win.start, end_date: win.end, phase, focus: focus.code, focus_skill: focus.skill, budget_minutes: budget, study_dates: dates, checkin_done_at: null, adjustment: null });
    if (!dates.length || budget <= 0) return;
    let used = 0;
    const load = new Map(dates.map((d) => [d, 0]));
    const add = (t: Omit<MockPlanTaskRecord, 'id' | 'week_id' | 'status' | 'result_ref' | 'completed_at'>) => {
      tasks.push({ ...t, id: uuid(), week_id: weekId, status: 'pending', result_ref: null, completed_at: null });
      used += t.est_minutes;
      load.set(t.due_date, (load.get(t.due_date) ?? 0) + t.est_minutes);
    };
    const least = () => [...load.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))[0]![0];
    const last = dates[dates.length - 1]!;
    const mockDate = dates.length >= 2 ? dates[dates.length - 2]! : last;
    if (budget - used >= 5) add({ due_date: last, task_type: 'checkin', title: { vi: 'Điểm danh tuần', en: 'Weekly check-in' }, ref_type: null, ref_id: null, est_minutes: 5, evidence_code: 'weekly_checkin', evidence_params: { week_no } });
    for (const d of dates) {
      if (budget - used < 5) break;
      add({ due_date: d, task_type: 'vocab_review', title: { vi: `Ôn từ vựng: ${MOCK_VOCAB_LIST.title.vi}`, en: `Vocabulary review: ${MOCK_VOCAB_LIST.title.en}` }, ref_type: 'vocab_list', ref_id: MOCK_VOCAB_LIST.id, est_minutes: 5, evidence_code: 'daily_vocab', evidence_params: {} });
      bump('vocabulary', 5);
    }
    let hasFull = false;
    const fullMinutes = Math.ceil((FULL_TEST_LOCKED.duration_sec ?? 7200) / 60);
    if (fullWeeks.has(week_no) && budget - used >= fullMinutes) {
      add({ due_date: mockDate, task_type: 'full_test', title: { vi: FULL_TEST_LOCKED.title.vi ?? 'Full test', en: FULL_TEST_LOCKED.title.en ?? 'Full test' }, ref_type: 'test_set', ref_id: FULL_TEST_LOCKED.id, est_minutes: fullMinutes, evidence_code: week_no === n ? 'final_simulation' : 'cadence_full_test', evidence_params: { every_weeks: cadence } });
      bump('full_test', fullMinutes);
      hasFull = true;
    }
    const miniMinutes = Math.ceil((LR_MINI.duration_sec ?? 1200) / 60);
    if (phase === 'simulation' && !hasFull && budget - used >= miniMinutes) {
      add({ due_date: mockDate, task_type: 'timed_drill', title: { vi: LR_MINI.title.vi ?? 'Mini test', en: LR_MINI.title.en ?? 'Mini test' }, ref_type: 'test_set', ref_id: LR_MINI.id, est_minutes: miniMinutes, evidence_code: 'simulation_mini', evidence_params: {} });
      bump('full_test', miniMinutes);
    }
    if (phase === 'foundation' && budget - used >= MOCK_LESSON.est_minutes) {
      add({ due_date: least(), task_type: 'grammar', title: MOCK_LESSON.title, ref_type: 'lesson', ref_id: MOCK_LESSON.id, est_minutes: MOCK_LESSON.est_minutes, evidence_code: 'foundation_lesson', evidence_params: { section: MOCK_LESSON.section_code } });
      bump('reading', MOCK_LESSON.est_minutes);
    }
    // Lượt luyện 10 câu theo Part: Part trọng tâm trước, rồi Part yếu nhất → mạnh nhất, lặp đến hết ngân sách
    const order = [focus, ...ranked.filter((s) => s.code !== focus.code)];
    let k = 0;
    let guard = 0;
    while (guard++ < 200) {
      const fitting = order.filter((s) => s.minutes <= budget - used);
      if (!fitting.length) break;
      const s = order[k % order.length]!;
      k++;
      if (s.minutes > budget - used) continue;
      const timed = phase === 'simulation';
      const isFocus = s.code === focus.code;
      add({
        due_date: least(),
        task_type: timed ? 'timed_drill' : 'part_drill',
        title: timed ? { vi: `Luyện tính giờ ${s.name.vi} – 10 câu`, en: `Timed drill ${s.name.en} – 10 questions` } : { vi: `Luyện ${s.name.vi} – 10 câu`, en: `Practice ${s.name.en} – 10 questions` },
        ref_type: 'section',
        ref_id: s.id,
        est_minutes: s.minutes,
        evidence_code: isFocus ? 'focus_section' : 'weak_section',
        evidence_params: { section: s.code, mastery_pct: Math.round((inp.mastery[s.code] ?? 0.5) * 100), questions: 10 },
      });
      bump(s.skill, s.minutes);
    }
  });
  return { weeks, tasks, full_test_every_weeks: cadence, minutes_per_skill: perSkill };
}

// ----------------------------------------------------------------------------- tiến độ (như @allingo/planner)
type ProgressTask = Pick<MockPlanTaskRecord, 'due_date' | 'est_minutes' | 'status' | 'task_type' | 'id'>;
const counted = (ts: readonly ProgressTask[]) => ts.filter((t) => t.status !== 'skipped');
function weekPct(ts: readonly ProgressTask[]): number {
  const c = counted(ts);
  const totalM = c.reduce((a, t) => a + t.est_minutes, 0);
  const done = c.filter((t) => t.status === 'done').reduce((a, t) => a + t.est_minutes, 0);
  return totalM ? Math.round((done / totalM) * 1000) / 10 : 0;
}
function forecast(ts: readonly ProgressTask[], today: string): { status: StudyPlan['progress']['forecast']; ratio: number | null } {
  const due = ts.filter((t) => t.status !== 'skipped' && (t.due_date < today || (t.due_date === today && t.status === 'done')));
  const dueM = due.reduce((a, t) => a + t.est_minutes, 0);
  if (!dueM) return { status: 'not_started', ratio: null };
  const ratio = Math.round((due.filter((t) => t.status === 'done').reduce((a, t) => a + t.est_minutes, 0) / dueM) * 1000) / 1000;
  return { status: ratio >= 0.8 ? 'on_track' : ratio >= 0.5 ? 'slightly_behind' : 'behind', ratio };
}
const QUICK_PRIORITY: Record<string, number> = { vocab_review: 0, review_errors: 1, part_drill: 2, timed_drill: 3, grammar: 4, lesson: 4, checkin: 5 };
function quick(ts: readonly ProgressTask[], limit = 15) {
  const pending = ts.filter((t) => t.status === 'pending' && t.task_type !== 'full_test');
  const ordered = [...pending].sort((a, b) => (QUICK_PRIORITY[a.task_type] ?? 9) - (QUICK_PRIORITY[b.task_type] ?? 9) || b.due_date.localeCompare(a.due_date) || a.est_minutes - b.est_minutes);
  const items: { task_id: string; est_minutes: number; shortened: boolean }[] = [];
  let used = 0;
  for (const t of ordered) {
    if (t.task_type === 'checkin') continue;
    if (used + t.est_minutes <= limit) {
      items.push({ task_id: t.id, est_minutes: t.est_minutes, shortened: false });
      used += t.est_minutes;
    }
  }
  if (!items.some((i) => ordered.find((t) => t.id === i.task_id)?.task_type !== 'vocab_review')) {
    const drill = ordered.find((t) => t.task_type !== 'vocab_review' && t.task_type !== 'checkin' && !items.some((i) => i.task_id === t.id));
    if (drill && limit - used >= 5) {
      items.push({ task_id: drill.id, est_minutes: limit - used, shortened: true });
      used = limit;
    }
  }
  return { minutes: used, items };
}

// ----------------------------------------------------------------------------- chuỗi ngày (như rules.ts của API)
function applyStudyDay(prev: MockStreakRecord | undefined, today: string, canFreeze: boolean): MockStreakRecord {
  const base = prev ?? { current: 0, longest: 0, last_active_date: null, freeze_available_at: null, freezes_used: 0 };
  if (!base.last_active_date) return { ...base, current: 1, longest: Math.max(1, base.longest), last_active_date: today };
  const gap = daysBetween(base.last_active_date, today);
  if (gap <= 0) return base;
  if (gap === 1) return { ...base, current: base.current + 1, longest: Math.max(base.longest, base.current + 1), last_active_date: today };
  const freezeReady = !base.freeze_available_at || base.freeze_available_at <= today;
  if (gap === 2 && canFreeze && freezeReady && base.current > 0) return { ...base, current: base.current + 1, longest: Math.max(base.longest, base.current + 1), last_active_date: today, freezes_used: base.freezes_used + 1, freeze_available_at: addDays(today, 7) };
  return { ...base, current: 1, longest: Math.max(base.longest, 1), last_active_date: today };
}
function effectiveStreak(s: MockStreakRecord | undefined, today: string, canFreeze: boolean) {
  const freeze_available = canFreeze && (!s?.freeze_available_at || s.freeze_available_at <= today);
  if (!s?.last_active_date) return { current: 0, longest: s?.longest ?? 0, at_risk: false, freeze_available, studied_today: false };
  const gap = daysBetween(s.last_active_date, today);
  if (gap <= 0) return { current: s.current, longest: s.longest, at_risk: false, freeze_available, studied_today: true };
  if (gap === 1) return { current: s.current, longest: s.longest, at_risk: s.current > 0, freeze_available, studied_today: false };
  if (gap === 2 && freeze_available && s.current > 0) return { current: s.current, longest: s.longest, at_risk: true, freeze_available, studied_today: false };
  return { current: 0, longest: s.longest, at_risk: false, freeze_available, studied_today: false };
}

// ----------------------------------------------------------------------------- module
export interface LearningPlanApi {
  routes: MockRouteDef[];
  /** Bài đã chấm (POST /attempts/{id}/submit) → task lộ trình done, chuỗi ngày, huy hiệu */
  onAttemptGraded: (a: MockAttemptRecord) => void;
  /** Phần S9 của GET /me/stats */
  statsExtras: (u: MockUserRecord) => Pick<Stats, 'streak' | 'xp' | 'badges' | 'plan'>;
  /** POST /attempts {section_id} – lượt luyện 10 câu của Part (kèm plan_task_id); null = không phải section mock */
  createSectionAttempt: (u: MockUserRecord, body: { section_id?: string; mode?: AttemptMode; plan_task_id?: string }, idempotencyKey: string | null) => Response | null;
  /** Ghép tiến độ khách → tài khoản (đăng ký/đăng nhập) */
  merge: (fromUserId: string, toUserId: string) => void;
  /** Câu hỏi của ngân hàng chẩn đoán (để questionsOf/Review tìm thấy) */
  questions: MockQuestion[];
}

export function learningPlanMock(d: LearningPlanDeps): LearningPlanApi {
  const { state, persist, route, json, error, uuid, nowIso, requireUser } = d;
  const tzOf = (u: MockUserRecord) => (u.timezone && isValidTz(u.timezone) ? u.timezone : 'Asia/Ho_Chi_Minh');
  const todayOf = (u: MockUserRecord) => localDate(state.plans[u.id]?.settings.timezone ?? tzOf(u));
  const localeOf = (u: MockUserRecord) => (u.ui_locale === 'en' ? 'en' : 'vi');

  const awardXp = (userId: string, kind: string, xp: number, ref: string | null, alsoTotal = true) => {
    const log = (state.xpLog[userId] ??= []);
    if (ref && log.some((x) => x.kind === kind && x.ref === ref)) return 0;
    log.push({ kind, xp, at: nowIso(), ref });
    if (log.length > 500) log.shift();
    if (alsoTotal) state.xp[userId] = (state.xp[userId] ?? 0) + xp;
    return xp;
  };

  const recordStudyDay = (u: MockUserRecord) => {
    const today = todayOf(u);
    const prev = state.streaks[u.id];
    const next = applyStudyDay(prev, today, d.isPro(u));
    if (prev?.last_active_date !== today) awardXp(u.id, 'streak_day', XP_TABLE.streak_day, today);
    state.streaks[u.id] = next;
    evaluateBadges(u);
  };

  const badgeFacts = (u: MockUserRecord) => {
    const graded = Object.values(state.attempts).filter((a) => a.user_id === u.id && a.result);
    const scored = graded.filter((a) => a.result?.scaled_score !== null && a.result?.scaled_score !== undefined && (a.mode === 'exam' || a.mode === 'diagnostic')).sort((x, y) => (x.submitted_at ?? '').localeCompare(y.submitted_at ?? ''));
    const s = state.streaks[u.id];
    const eff = effectiveStreak(s, todayOf(u), d.isPro(u));
    return {
      attempts_graded: graded.filter((a) => a.mode !== 'diagnostic').length,
      full_tests_graded: graded.filter((a) => a.test_set_id === FULL_TEST_LOCKED.id).length,
      answered_total: graded.reduce((acc, a) => acc + Object.keys(a.answers).length, 0),
      longest_streak: s?.longest ?? 0,
      current_streak: eff.current,
      score_delta: scored.length >= 2 ? Math.max(...scored.map((a) => a.result!.scaled_score!)) - scored[0]!.result!.scaled_score! : 0,
    };
  };
  const evalRule = (rule: Record<string, unknown>, f: ReturnType<typeof badgeFacts>) => {
    const mk = (current: number, target: number) => ({ earned: target > 0 && current >= target, progress: { current: Math.min(current, target), target } });
    if (typeof rule.streak === 'number') return mk(Math.max(f.longest_streak, f.current_streak), rule.streak);
    if (typeof rule.answered === 'number') return mk(f.answered_total, rule.answered);
    if (typeof rule.score_delta === 'number') return mk(Math.max(0, f.score_delta), rule.score_delta);
    if (rule.event === 'attempt.graded' && typeof rule.count === 'number') return mk(rule.kind === 'full' ? f.full_tests_graded : f.attempts_graded, rule.count);
    return { earned: false, progress: null };
  };
  const evaluateBadges = (u: MockUserRecord) => {
    const f = badgeFacts(u);
    const mine = (state.badges[u.id] ??= {});
    for (const b of BADGES) {
      if (mine[b.code]) continue;
      if (!evalRule(b.rule, f).earned) continue;
      mine[b.code] = nowIso();
      notify(state, u.id, 'learning.badge_awarded', { badge_code: b.code, badge_name: b.name }, { category: 'learning', url: '/badges' });
    }
  };

  // ------------------------------------------------------------------ DTO
  const launchOf = (t: MockPlanTaskRecord): PlanTask['launch'] => {
    const base = { mode: null, test_set_id: null, section_id: null, lesson_id: null, vocab_list_id: null };
    if (t.task_type === 'checkin') return { ...base, kind: 'checkin' };
    if (t.task_type === 'review_errors') return { ...base, kind: 'review_errors', mode: 'timed_drill' };
    if (!t.ref_type || !t.ref_id) return null;
    if (t.ref_type === 'lesson') return { ...base, kind: 'lesson', lesson_id: t.ref_id };
    if (t.ref_type === 'vocab_list') return { ...base, kind: 'vocab_list', vocab_list_id: t.ref_id };
    if (t.ref_type === 'test_set') return { ...base, kind: 'attempt', mode: t.task_type === 'full_test' || t.task_type === 'timed_drill' ? 'exam' : 'practice', test_set_id: t.ref_id };
    return { ...base, kind: 'attempt', mode: t.task_type === 'timed_drill' ? 'timed_drill' : 'practice', section_id: t.ref_id };
  };
  const taskDto = (t: MockPlanTaskRecord, today: string): PlanTask => ({
    id: t.id,
    plan_week_id: t.week_id,
    due_date: t.due_date,
    task_type: t.task_type,
    title: t.title,
    ref: t.ref_type && t.ref_id ? { type: t.ref_type, id: t.ref_id } : null,
    est_minutes: t.est_minutes,
    status: t.status,
    evidence: null,
    evidence_code: t.evidence_code,
    evidence_params: t.evidence_params,
    result_ref: t.result_ref,
    completed_at: t.completed_at,
    launch: launchOf(t),
    overdue: t.status === 'pending' && t.due_date < today,
    ...(t.task_type === 'vocab_review' ? { srs_due: t.status === 'pending' ? 10 : null } : {}),
  });
  const weekIndex = (p: MockPlanRecord, today: string) => {
    const i = p.weeks.findIndex((w) => today >= w.start_date && today <= w.end_date);
    if (i >= 0) return i;
    return p.weeks.length && today < p.weeks[0]!.start_date ? 0 : Math.max(0, p.weeks.length - 1);
  };
  const loadOf = (ts: readonly MockPlanTaskRecord[]) => ts.filter((t) => t.status !== 'skipped' && t.status !== 'expired').reduce((a, t) => a + t.est_minutes, 0);
  const weekDto = (p: MockPlanRecord, w: MockPlanWeekRecord, today: string, locked: boolean): PlanWeek => {
    const ts = p.tasks.filter((t) => t.week_id === w.id);
    const days: PlanWeek['days'] = [];
    if (!locked)
      for (let i = 0; i <= daysBetween(w.start_date, w.end_date); i++) {
        const date = addDays(w.start_date, i);
        const list = ts.filter((t) => t.due_date === date);
        const c = list.filter((t) => t.status !== 'skipped');
        const done = c.filter((t) => t.status === 'done').length;
        days.push({ date, status: !c.length ? 'rest' : done === c.length ? 'done' : done ? 'partial' : 'pending', tasks: list.map((t) => taskDto(t, today)) });
      }
    return { id: w.id, week_no: w.week_no, start_date: w.start_date, end_date: w.end_date, phase: w.phase, focus: w.focus, focus_skill: w.focus_skill, load_minutes: loadOf(ts), budget_minutes: w.budget_minutes, checkin_done: !!w.checkin_done_at, adjustment: w.adjustment, locked, progress_pct: weekPct(ts), days };
  };
  const expireDue = (p: MockPlanRecord, today: string) => {
    let changed = false;
    for (const t of p.tasks)
      if (t.status === 'pending' && daysBetween(t.due_date, today) > 3) {
        t.status = 'expired';
        changed = true;
      }
    if (changed) persist();
  };
  // Bài chẩn đoán đã có ước tính riêng (baseline) – điểm gần nhất chỉ lấy bài thi Exam Mode
  const latestScore = (userId: string) =>
    Object.values(state.attempts)
      .filter((a) => a.user_id === userId && a.result?.scaled_score !== null && a.result?.scaled_score !== undefined && a.mode === 'exam')
      .sort((x, y) => (y.submitted_at ?? '').localeCompare(x.submitted_at ?? ''))[0]?.result?.scaled_score ?? null;

  const planDto = (u: MockUserRecord, p: MockPlanRecord): StudyPlan => {
    const today = todayOf(u);
    expireDue(p, today);
    const pro = d.isPro(u);
    const cur = weekIndex(p, today);
    const lockedFrom = pro ? null : cur + 2;
    const curWeek = p.weeks[cur];
    const fc = forecast(p.tasks, today);
    const exam = p.settings.exam_date;
    const totalDays = exam ? Math.max(1, daysBetween(p.settings.start_date, exam)) : null;
    return {
      id: p.id,
      program: p.program as StudyPlan['program'],
      version_no: p.version_no,
      generated_by: 'rule',
      generated_at: p.generated_at,
      target: { score: p.settings.target_score, exam_date: exam, suggested: p.target_suggestion?.suggested ?? null, feasible: p.target_suggestion?.feasible ?? null },
      predicted_now: latestScore(u.id) ?? p.baseline?.score ?? null,
      baseline: p.baseline,
      weeks_total: p.weeks.length,
      week_current: p.weeks.length ? cur + 1 : null,
      progress_pct: weekPct(p.tasks),
      minutes_per_skill: p.minutes_per_skill,
      mastery_path: null,
      weeks: p.weeks.map((w) => weekDto(p, w, today, lockedFrom !== null && w.week_no >= lockedFrom)),
      locked_weeks_from: lockedFrom,
      settings: p.settings,
      progress: {
        week_pct: curWeek ? weekPct(p.tasks.filter((t) => t.week_id === curWeek.id)) : 0,
        plan_pct: weekPct(p.tasks),
        exam_pct: exam && totalDays ? Math.round((Math.max(0, Math.min(totalDays, daysBetween(p.settings.start_date, today))) / totalDays) * 1000) / 10 : null,
        days_to_exam: exam ? Math.max(0, daysBetween(today, exam)) : null,
        forecast: fc.status,
        forecast_ratio: fc.ratio,
      },
      is_pro: pro,
      full_test_every_weeks: p.full_test_every_weeks,
    };
  };

  const proposalDto = (r: MockProposalRecord): PlanAdjustProposal => {
    const { id, user_id: _u, plan_id: _p, patch: _pt, resolve_at: _ra, resolve_to: _rt, ...rest } = r;
    const expired = (rest.status === 'ready' || rest.status === 'needs_clarification') && Date.parse(rest.expires_at) <= Date.now();
    return { ...rest, proposal_id: id, status: expired ? 'expired' : rest.status };
  };

  /** Đề xuất pending đã tới hạn "job xong" → trạng thái cuối + realtime + thông báo (như worker plan.adjust) */
  const settleProposals = () => {
    let changed = false;
    for (const r of Object.values(state.proposals)) {
      if (r.status !== 'pending' || r.resolve_at === null || r.resolve_at > Date.now() || !r.resolve_to) continue;
      r.status = r.resolve_to;
      r.resolve_at = null;
      changed = true;
      emitTo(state, r.user_id, 'plan.updated', { proposal_id: r.id, status: r.status, reason: 'proposal' });
      if (r.status === 'ready' && r.source === 'checkin') notify(state, r.user_id, 'learning.plan_adjust_ready', { proposal_id: r.id }, { category: 'learning', url: `/toeic/plan?proposal=${r.id}` });
    }
    if (changed) persist();
  };
  const scheduleSettle = (ms: number) => {
    if (typeof window !== 'undefined') window.setTimeout(settleProposals, ms + 20);
  };

  /** Dựng đề xuất giảm tải / dời việc cho các tuần trong phạm vi (đã kiểm tra ràng buộc như applyAdjustOps) */
  const buildProposal = (u: MockUserRecord, p: MockPlanRecord, week: MockPlanWeekRecord, source: 'checkin' | 'instruction', opts: { maxMinutes: number | null; moveFrom?: string | null; summary: string; clarify?: string | null }): MockProposalRecord => {
    const today = todayOf(u);
    const ts = p.tasks.filter((t) => t.week_id === week.id);
    const before = ts.map((t) => taskDto(t, today));
    const patch: MockProposalRecord['patch'] = [];
    const changes: PlanAdjustProposal['changes'] = [];
    const operations: Record<string, unknown>[] = [];
    let load = loadOf(ts);
    const minutesBefore = load;
    if (opts.maxMinutes !== null) {
      operations.push({ op: 'reduce_load_week', minutes: opts.maxMinutes, from_date: week.start_date });
      // Bỏ lượt luyện dài nhất trước (giữ ôn từ, điểm danh, full test), chỉ việc chưa làm ở hôm nay/tương lai
      const candidates = ts.filter((t) => t.status === 'pending' && t.due_date >= today && (t.task_type === 'part_drill' || t.task_type === 'timed_drill' || t.task_type === 'grammar' || t.task_type === 'lesson')).sort((a, b) => b.est_minutes - a.est_minutes || a.due_date.localeCompare(b.due_date));
      for (const t of candidates) {
        if (load <= opts.maxMinutes) break;
        patch.push({ task_id: t.id, status: 'skipped' });
        changes.push({ task_id: t.id, op: 'reduce_load_week', field: 'status', from: 'pending', to: 'skipped' });
        load -= t.est_minutes;
      }
    }
    if (opts.moveFrom) {
      const moving = ts.filter((t) => t.status === 'pending' && t.due_date === opts.moveFrom && t.due_date >= today && t.task_type !== 'checkin');
      const targets = week.study_dates.filter((x) => x > opts.moveFrom! && x >= today && (!p.settings.exam_date || x < p.settings.exam_date));
      const to = targets[targets.length - 1] ?? null;
      operations.push({ op: 'move', from_date: opts.moveFrom, to_date: to });
      if (to)
        for (const t of moving) {
          patch.push({ task_id: t.id, due_date: to });
          changes.push({ task_id: t.id, op: 'move', field: 'due_date', from: t.due_date, to });
        }
    }
    const violations: PlanAdjustProposal['violations'] = [];
    if (opts.maxMinutes !== null && load > opts.maxMinutes) violations.push({ code: 'cannot_reduce', week_id: week.id, detail: `${load} > ${opts.maxMinutes}` });
    const after = before.map((t) => {
      const c = patch.find((x) => x.task_id === t.id);
      return c ? { ...t, ...(c.status ? { status: c.status } : {}), ...(c.due_date ? { due_date: c.due_date } : {}), ...(c.est_minutes ? { est_minutes: c.est_minutes } : {}) } : t;
    });
    const status: PlanAdjustProposal['status'] = opts.clarify ? 'needs_clarification' : violations.length ? 'rejected' : 'ready';
    return {
      id: uuid(),
      user_id: u.id,
      plan_id: p.id,
      status: 'pending',
      source,
      summary: opts.summary,
      clarifying_question: opts.clarify ?? null,
      operations,
      before,
      after,
      changes,
      violations,
      week: { id: week.id, week_no: week.week_no, start_date: week.start_date, end_date: week.end_date },
      minutes_before: minutesBefore,
      minutes_after: load,
      budget_minutes: week.budget_minutes,
      max_minutes: opts.maxMinutes,
      created_at: nowIso(),
      expires_at: new Date(Date.now() + 72 * 3_600_000).toISOString(),
      applied_at: null,
      patch,
      resolve_at: Date.now() + 900,
      resolve_to: status,
    };
  };

  // ------------------------------------------------------------------ chẩn đoán
  const items: DiagnosticItem[] = MOCK_DIAGNOSTIC_QUESTIONS.map((q) => ({
    question_id: q.question_id,
    section_code: q.section_code,
    skill: TOEIC_PART_SKILL[q.section_code] ?? 'reading',
    group_key: q.group_key,
    subskills: [...new Set((q.content.tags ?? []).map((t) => MOCK_SUBSKILL_OF_TAG[t]).filter((x): x is string => !!x))],
    difficulty: MOCK_DIAGNOSTIC_DIFFICULTY[q.question_id] ?? 'B1',
    order: q.order_no,
  }));
  const pool = buildDiagnosticPool(items);
  const blueprint = MOCK_DIAGNOSTIC_BLUEPRINT.map((b) => ({ ...b }));
  const qById = new Map(MOCK_DIAGNOSTIC_QUESTIONS.map((q) => [q.question_id, q]));

  const estimateDto = (served: DiagnosticState['served']): DiagnosticStep['estimate'] => {
    const e = estimateToeicDiagnostic(served);
    const L = e.by_skill.listening;
    const R = e.by_skill.reading;
    return { score: e.total?.score ?? null, se: e.se, low: e.total?.low ?? null, high: e.total?.high ?? null, listening: L ? { score: L.score, low: L.low, high: L.high } : null, reading: R ? { score: R.score, low: R.low, high: R.high } : null, answered: e.answered, estimated: true };
  };

  const finalizeDiagnostic = (u: MockUserRecord, a: MockAttemptRecord): DiagnosticResult => {
    const st = a.adaptive!;
    const e = estimateToeicDiagnostic(st.served);
    const mastery = masteryFromDiagnostic(st.served);
    const list = (state.enrollments[u.id] ??= []);
    let enr = list.find((x) => x.program === 'toeic');
    if (!enr) {
      enr = { id: uuid(), program: 'toeic', target_score: null, target_level: null, exam_date: null, daily_minutes: 30, current_level: null, days_to_exam: null, diagnostic_attempt_id: null, started_at: nowIso() };
      list.push(enr);
    }
    if ((enr.current_level as { attempt_id?: string } | null)?.attempt_id !== a.id) {
      enr.current_level = { overall: e.total?.score ?? null, listening: e.by_skill.listening?.score ?? null, reading: e.by_skill.reading?.score ?? null, low: e.total?.low ?? null, high: e.total?.high ?? null, source: 'diagnostic', attempt_id: a.id, estimated_at: nowIso() };
      enr.diagnostic_attempt_id = a.id;
      state.mastery[u.id] = mastery.map((m) => ({ subskill: m.subskill, skill: m.skill, sections: m.sections, mastery: m.mastery, confidence: m.confidence, n_obs: m.n_obs }));
      awardXp(u.id, 'diagnostic_completed', XP_TABLE.diagnostic_completed, a.id);
      // Bài chẩn đoán được chấm = một lượt học (như attempt.graded của API): XP bài làm vào nhật ký + ngày học
      awardXp(u.id, 'attempt_graded', a.result?.xp_earned ?? 0, a.id, false);
      recordStudyDay(u);
    }
    const plan = state.plans[u.id];
    const weekly = plan?.settings.weekly_minutes ?? (enr.daily_minutes ?? 30) * 7;
    const target = suggestToeicTarget({ current: e.total?.score ?? 10, today: todayOf(u), examDate: enr.exam_date, weeklyMinutes: weekly, desired: enr.target_score });
    return {
      attempt_id: a.id,
      estimate: estimateDto(st.served)!,
      mastery: mastery.map((m) => ({ subskill: m.subskill, skill: m.skill, mastery: m.mastery, confidence: m.confidence, n_obs: m.n_obs })),
      target: { current: target.current, suggested: target.suggested, desired: target.desired, feasible: target.feasible, weeks_left: target.weeks_left, weekly_minutes: target.weekly_minutes, required_weekly_minutes: target.required_weekly_minutes, reason: target.reason },
    };
  };

  const stepDto = (u: MockUserRecord, a: MockAttemptRecord, lastCorrect: boolean | null): DiagnosticStep => {
    const st = a.adaptive!;
    const done = st.done;
    const result = done ? finalizeDiagnostic(u, a) : null;
    const current = st.current ? qById.get(st.current) : undefined;
    const answered = st.served.filter((s) => s.correct !== null);
    const servedNow = st.served.find((s) => s.question_id === st.current);
    return {
      attempt_id: a.id,
      done,
      next_question: current ? (d.publicQuestion({ ...current, order_no: st.served.length })) : null,
      progress: { answered: answered.length, served: st.served.length, planned: Math.max(st.planned, st.served.length), section_code: current?.section_code ?? null, level: servedNow?.level ?? null, group_remaining: st.queue.length },
      estimate: answered.length ? estimateDto(st.served) : null,
      last_correct: lastCorrect,
      result,
    };
  };

  // ------------------------------------------------------------------ hooks
  const onAttemptGraded = (a: MockAttemptRecord) => {
    const u = state.users[a.user_id];
    if (!u || a.mode === 'diagnostic') return;
    awardXp(u.id, 'attempt_graded', a.result?.xp_earned ?? 0, a.id, false);
    const p = state.plans[u.id];
    const t = a.plan_task_id ? p?.tasks.find((x) => x.id === a.plan_task_id) : undefined;
    if (p && t && (t.status === 'pending' || t.status === 'expired')) {
      t.status = 'done';
      t.completed_at = nowIso();
      t.result_ref = { attempt_id: a.id, source: 'attempt', scaled_score: a.result?.scaled_score ?? null };
      emitTo(state, u.id, 'plan.updated', { task_id: t.id, reason: 'task_done' });
    }
    recordStudyDay(u);
    evaluateBadges(u);
  };

  const statsExtras = (u: MockUserRecord): Pick<Stats, 'streak' | 'xp' | 'badges' | 'plan'> => {
    const today = todayOf(u);
    const s = state.streaks[u.id];
    const eff = effectiveStreak(s, today, d.isPro(u));
    const log = state.xpLog[u.id] ?? [];
    const total = state.xp[u.id] ?? 0;
    const tz = state.plans[u.id]?.settings.timezone ?? tzOf(u);
    const weekAgo = addDays(today, -6);
    const lv = levelForXp(total);
    const mine = state.badges[u.id] ?? {};
    const p = state.plans[u.id];
    const dto = p ? planDto(u, p) : null;
    return {
      streak: { current: eff.current, longest: Math.max(eff.longest, s?.longest ?? 0), freeze_available: eff.freeze_available, at_risk: eff.at_risk, last_active_date: s?.last_active_date ?? null, freezes_used: s?.freezes_used ?? 0 },
      xp: { total, this_week: log.filter((x) => localDate(tz, Date.parse(x.at)) >= weekAgo).reduce((acc, x) => acc + x.xp, 0), today: log.filter((x) => localDate(tz, Date.parse(x.at)) === today).reduce((acc, x) => acc + x.xp, 0), level: lv.level, next_level_at: lv.next_at },
      badges: { earned: Object.keys(mine).length, total: BADGES.length, latest: Object.entries(mine).sort((x, y) => y[1].localeCompare(x[1])).slice(0, 3).map(([code, earned_at]) => ({ code, earned_at })) },
      plan: dto ? { plan_id: dto.id, week_pct: dto.progress.week_pct, forecast: dto.progress.forecast, days_to_exam: dto.progress.days_to_exam } : null,
    };
  };

  const createSectionAttempt: LearningPlanApi['createSectionAttempt'] = (u, body, key) => {
    const sec = MOCK_PLAN_SECTIONS.find((s) => s.id === body.section_id);
    if (!sec) return null;
    const existing = Object.values(state.attempts).find((a) => a.user_id === u.id && a.status === 'in_progress' && ((key && a.idempotency_key === key) || (body.plan_task_id && a.plan_task_id === body.plan_task_id)));
    if (existing) return json(201, d.toAttemptDto(existing));
    const qs = d.sectionQuestions(sec.code);
    if (!qs.length) return error(404, 'not_found', 'No questions for section', { section_id: sec.id });
    const over = d.quotaExceeded(u, 'part_drill');
    if (over) return over;
    d.consumeQuota(u, 'part_drill');
    const picked: MockQuestion[] = [];
    for (const q of qs) {
      if (picked.includes(q)) continue;
      const group = q.group_key ? qs.filter((x) => x.group_key === q.group_key) : [q];
      if (picked.length + group.length > 10 && picked.length > 0) continue;
      picked.push(...group);
      if (picked.length >= 10) break;
    }
    const mode: AttemptMode = body.mode === 'timed_drill' ? 'timed_drill' : body.mode === 'exam' ? 'exam' : body.mode === 'drill' ? 'drill' : 'practice';
    const started = Date.now();
    const rec: MockAttemptRecord = {
      id: uuid(),
      user_id: u.id,
      // Lượt luyện theo section không thuộc một đề (như lượt /practice/questions) – câu nằm ở question_ids
      test_set_id: '',
      question_ids: picked.map((q) => q.question_id),
      program: 'toeic',
      mode,
      status: 'in_progress',
      started_at: new Date(started).toISOString(),
      expires_at: mode === 'timed_drill' ? new Date(started + picked.length * 45_000).toISOString() : null,
      submitted_at: null,
      answers: {},
      section_elapsed_sec: {},
      ui_state: {},
      events: [],
      result: null,
      plan_task_id: body.plan_task_id ?? null,
      idempotency_key: key,
    };
    state.attempts[rec.id] = rec;
    persist();
    return json(201, d.toAttemptDto(rec));
  };

  const merge = (from: string, to: string) => {
    if (state.plans[from] && !state.plans[to]) state.plans[to] = { ...state.plans[from], user_id: to };
    delete state.plans[from];
    for (const r of Object.values(state.proposals)) if (r.user_id === from) r.user_id = to;
    if (state.streaks[from] && !state.streaks[to]) state.streaks[to] = state.streaks[from];
    delete state.streaks[from];
    state.xpLog[to] = [...(state.xpLog[to] ?? []), ...(state.xpLog[from] ?? [])];
    delete state.xpLog[from];
    state.badges[to] = { ...(state.badges[from] ?? {}), ...(state.badges[to] ?? {}) };
    delete state.badges[from];
    if (state.mastery[from] && !state.mastery[to]) state.mastery[to] = state.mastery[from];
    delete state.mastery[from];
  };

  // E2E: chỉnh chuỗi ngày ("hôm qua là ngày thứ n") để thử huy hiệu 7 ngày / cảnh báo sắp mất – chỉ mock
  if (typeof window !== 'undefined') {
    const w = window as unknown as { __ALLINGO_MOCK__?: Record<string, unknown> };
    w.__ALLINGO_MOCK__ = {
      ...(w.__ALLINGO_MOCK__ ?? {}),
      /** Đáp án đúng của câu chẩn đoán mock (E2E kiểm tra luật lên mức) */
      diagnosticKey: (questionId: string) => {
        const c = MOCK_DIAGNOSTIC_QUESTIONS.find((x) => x.question_id === questionId)?.content;
        return c?.type === 'mcq_single' ? c.answer_key.correct : null;
      },
      seedStreak: (days: number) => {
        const uidNow = state.sessionUserId;
        const u = uidNow ? state.users[uidNow] : null;
        if (!u) return false;
        const yesterday = addDays(todayOf(u), -1);
        state.streaks[u.id] = { current: days, longest: Math.max(days, state.streaks[u.id]?.longest ?? 0), last_active_date: yesterday, freeze_available_at: null, freezes_used: 0 };
        persist();
        return true;
      },
    };
  }

  // ------------------------------------------------------------------ routes
  const routes: MockRouteDef[] = [
    route('POST', '/me/diagnostic', () => {
      const u = requireUser();
      if (u instanceof Response) return u;
      let a = Object.values(state.attempts).find((x) => x.user_id === u.id && x.mode === 'diagnostic' && x.status === 'in_progress');
      if (!a) {
        a = { id: uuid(), user_id: u.id, test_set_id: MOCK_DIAGNOSTIC_SET.id, question_ids: [], program: 'toeic', mode: 'diagnostic', status: 'in_progress', started_at: nowIso(), expires_at: null, submitted_at: null, answers: {}, section_elapsed_sec: {}, ui_state: {}, events: [], result: null, adaptive: initDiagnosticState(pool, blueprint) };
        a.adaptive = diagnosticAdvance(pool, blueprint, a.adaptive!).state;
        a.question_ids = a.adaptive.served.map((s) => s.question_id);
        state.attempts[a.id] = a;
        persist();
      }
      return json(200, stepDto(u, a, null));
    }),
    route('GET', '/me/diagnostic/{attemptId}/next', ({ params }) => {
      const u = requireUser();
      if (u instanceof Response) return u;
      const a = state.attempts[params.attemptId!];
      if (!a || a.user_id !== u.id || a.mode !== 'diagnostic' || !a.adaptive) return error(404, 'not_found', 'Diagnostic attempt not found');
      return json(200, stepDto(u, a, null));
    }),
    route('POST', '/me/diagnostic/{attemptId}/next', ({ params, body }) => {
      const u = requireUser();
      if (u instanceof Response) return u;
      const a = state.attempts[params.attemptId!];
      if (!a || a.user_id !== u.id || a.mode !== 'diagnostic' || !a.adaptive) return error(404, 'not_found', 'Diagnostic attempt not found');
      const b = (body ?? {}) as { question_id?: string; answer?: { type: string; selected?: string | null }; time_spent_ms?: number };
      if (!b.question_id || !b.answer) return json(200, stepDto(u, a, null));
      if (a.adaptive.done || a.status !== 'in_progress') return error(409, 'conflict', 'Diagnostic already finished', { reason: 'already_done', status: a.status });
      if (a.adaptive.current !== b.question_id) return error(409, 'conflict', 'Answer is not for the current question', { reason: 'not_current', current_question_id: a.adaptive.current });
      const q = qById.get(b.question_id)!;
      const correct = q.content.type === 'mcq_single' && b.answer.type === 'mcq_single' && b.answer.selected === q.content.answer_key.correct;
      a.answers[q.question_id] = { answer: b.answer as never, time_spent_ms: b.time_spent_ms };
      a.adaptive = diagnosticAdvance(pool, blueprint, a.adaptive, { question_id: q.question_id, correct }).state;
      a.question_ids = a.adaptive.served.map((s) => s.question_id);
      if (a.adaptive.done) {
        d.finishAttempt(a);
        a.status = 'graded';
        a.submitted_at = nowIso();
      }
      persist();
      const step = stepDto(u, a, correct);
      persist();
      return json(200, step);
    }),

    route('GET', '/me/plan', ({ url }) => {
      const u = requireUser();
      if (u instanceof Response) return u;
      const p = state.plans[u.id];
      if (!p || p.program !== (url.searchParams.get('program') ?? 'toeic')) return error(404, 'not_found', 'study_plan not found', { entity: 'study_plan', id: url.searchParams.get('program') ?? 'toeic' });
      return json(200, planDto(u, p));
    }),
    route('POST', '/me/plan', ({ body }) => {
      const u = requireUser();
      if (u instanceof Response) return u;
      const parsed = planCreateInputSchema.safeParse(body);
      if (!parsed.success) return error(400, 'validation_failed', 'Invalid plan input', { issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
      const inp = parsed.data;
      const tz = inp.timezone ?? tzOf(u);
      if (!isValidTz(tz)) return error(400, 'validation_failed', 'Invalid time zone', { issues: [{ path: 'timezone', message: 'invalid IANA time zone' }] });
      u.timezone = tz;
      const today = localDate(tz);
      if (inp.exam_date && (inp.exam_date <= today || daysBetween(today, inp.exam_date) > 730)) return error(400, 'validation_failed', 'Invalid exam date', { issues: [{ path: 'exam_date', message: 'exam_date must be after today and within 2 years' }] });
      const list = (state.enrollments[u.id] ??= []);
      let enr = list.find((x) => x.program === inp.program);
      if (!enr) {
        enr = { id: uuid(), program: inp.program, target_score: null, target_level: null, exam_date: null, daily_minutes: 30, current_level: null, days_to_exam: null, diagnostic_attempt_id: null, started_at: nowIso() };
        list.push(enr);
      }
      if (inp.target_score !== undefined) enr.target_score = inp.target_score;
      if (inp.exam_date) enr.exam_date = inp.exam_date;
      enr.daily_minutes = Math.max(10, Math.min(240, Math.round(inp.weekly_minutes / inp.study_days.length)));
      const level = (enr.current_level ?? {}) as { overall?: number; low?: number; high?: number; source?: string };
      // Mastery theo Part = trung bình mastery các kỹ năng con đo Part đó (như PlanService.masteryRows)
      const acc: Record<string, number[]> = {};
      for (const m of state.mastery[u.id] ?? []) for (const s of m.sections ?? []) (acc[s] ??= []).push(m.mastery);
      const masteryBySection = Object.fromEntries(Object.entries(acc).map(([s, xs]) => [s, xs.reduce((a, b) => a + b, 0) / xs.length]));
      const days = WEEKDAY_CODES.filter((x) => inp.study_days.includes(x));
      const gen = mockGeneratePlan({ startDate: today, examDate: inp.exam_date ?? null, weeklyMinutes: inp.weekly_minutes, studyDays: days, isPro: d.isPro(u), mastery: masteryBySection }, uuid);
      const baseline = typeof level.overall === 'number' ? { score: level.overall, low: level.low ?? null, high: level.high ?? null, source: level.source ?? 'diagnostic' } : null;
      const sugg = baseline ? suggestToeicTarget({ current: baseline.score, today, examDate: inp.exam_date ?? null, weeklyMinutes: inp.weekly_minutes, desired: inp.target_score ?? null }) : null;
      const prev = state.plans[u.id];
      // Đề xuất của phiên bản cũ không còn áp dụng được
      for (const r of Object.values(state.proposals)) if (r.user_id === u.id && ['pending', 'ready', 'needs_clarification'].includes(r.status)) r.status = 'superseded';
      const plan: MockPlanRecord = {
        id: uuid(),
        user_id: u.id,
        program: inp.program,
        version_no: (prev?.version_no ?? 0) + 1,
        generated_at: nowIso(),
        settings: { weekly_minutes: inp.weekly_minutes, study_days: days, reminder_time: inp.reminder_time ?? null, timezone: tz, start_date: today, exam_date: inp.exam_date ?? null, target_score: inp.target_score ?? enr.target_score ?? null },
        baseline,
        target_suggestion: sugg ? { suggested: sugg.suggested, feasible: sugg.feasible } : null,
        ...gen,
      };
      state.plans[u.id] = plan;
      persist();
      emitTo(state, u.id, 'plan.updated', { plan_id: plan.id, program: plan.program, reason: 'generated' });
      return json(201, planDto(u, plan));
    }),
    route('POST', '/me/plan/regenerate', () => {
      const u = requireUser();
      if (u instanceof Response) return u;
      const p = state.plans[u.id];
      if (!p) return error(404, 'not_found', 'study_plan not found');
      const today = todayOf(u);
      const examDate = p.settings.exam_date && p.settings.exam_date > today ? p.settings.exam_date : null;
      const gen = mockGeneratePlan({ startDate: today, examDate, weeklyMinutes: p.settings.weekly_minutes, studyDays: p.settings.study_days, isPro: d.isPro(u), mastery: {} }, uuid);
      const next: MockPlanRecord = { ...p, id: uuid(), version_no: p.version_no + 1, generated_at: nowIso(), settings: { ...p.settings, start_date: today, exam_date: examDate }, ...gen };
      const jobId = `plan.generate:${p.id}`;
      // Mô phỏng job hàng đợi: 202 queued → ~0,8 s sau lưu bản mới + realtime `plan.updated` (reason generated)
      if (typeof window !== 'undefined')
        window.setTimeout(() => {
          for (const r of Object.values(state.proposals)) if (r.user_id === u.id && ['pending', 'ready', 'needs_clarification'].includes(r.status)) r.status = 'superseded';
          state.plans[u.id] = next;
          persist();
          emitTo(state, u.id, 'plan.updated', { plan_id: next.id, program: next.program, reason: 'generated' });
        }, 800);
      return json(202, { job_id: jobId, status: 'queued', plan_id: null });
    }),
    route('GET', '/me/plan/today', () => {
      const u = requireUser();
      if (u instanceof Response) return u;
      const today = todayOf(u);
      const eff = effectiveStreak(state.streaks[u.id], today, d.isPro(u));
      const base = { date: today, timezone: state.plans[u.id]?.settings.timezone ?? tzOf(u), studied_today: eff.studied_today, streak: { current: eff.current, at_risk: eff.at_risk, freeze_available: eff.freeze_available } };
      const p = state.plans[u.id];
      if (!p) return json(200, { ...base, plan_id: null, focus: null, tasks: [], overdue: [], warmup: null, quick: { minutes: 0, items: [] }, week: null } satisfies PlanToday);
      expireDue(p, today);
      const todayRows = p.tasks.filter((t) => t.due_date === today);
      const overdue = p.tasks.filter((t) => t.status === 'pending' && t.due_date < today);
      const cur = p.weeks[weekIndex(p, today)];
      const weekTasks = cur ? p.tasks.filter((t) => t.week_id === cur.id) : [];
      const checkin = weekTasks.find((t) => t.task_type === 'checkin');
      const warm = todayRows.find((t) => t.task_type === 'vocab_review' && t.status === 'pending');
      const dto: PlanToday = {
        ...base,
        plan_id: p.id,
        focus: cur?.focus ?? null,
        tasks: todayRows.map((t) => taskDto(t, today)),
        overdue: overdue.map((t) => taskDto(t, today)),
        warmup: warm ? taskDto(warm, today) : null,
        quick: quick([...todayRows, ...overdue]),
        week: cur ? { id: cur.id, week_no: cur.week_no, progress_pct: weekPct(weekTasks), checkin_due: !cur.checkin_done_at && !!checkin && checkin.due_date <= today, checkin_done: !!cur.checkin_done_at } : null,
      };
      return json(200, dto);
    }),
    route('PATCH', '/plan-tasks/{taskId}', ({ params, body }) => {
      const u = requireUser();
      if (u instanceof Response) return u;
      const parsed = planTaskPatchSchema.safeParse(body);
      if (!parsed.success) return error(400, 'validation_failed', 'Invalid patch', { issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
      const owner = Object.values(state.plans).find((p) => p.tasks.some((t) => t.id === params.taskId));
      if (!owner) return error(404, 'not_found', 'plan_task not found');
      if (owner.user_id !== u.id) return error(403, 'forbidden', 'Not your task');
      const t = owner.tasks.find((x) => x.id === params.taskId)!;
      const w = owner.weeks.find((x) => x.id === t.week_id)!;
      const today = todayOf(u);
      const patch = parsed.data;
      const bad = (message: string, extra: Record<string, unknown> = {}) => error(400, 'validation_failed', message, { issues: [{ path: 'due_date', message, ...extra }] });
      if (patch.due_date && patch.due_date !== t.due_date) {
        if (t.status !== 'pending') return bad('only pending tasks can be rescheduled');
        if (patch.due_date < w.start_date || patch.due_date > w.end_date) return bad('due_date must stay within the same plan week', { week_start: w.start_date, week_end: w.end_date });
        if (patch.due_date < today) return bad('due_date cannot be in the past');
        if (owner.settings.exam_date && patch.due_date >= owner.settings.exam_date) return bad('due_date must be before exam_date');
        t.due_date = patch.due_date;
      }
      let completedNow = false;
      if (patch.status && patch.status !== t.status) {
        if (patch.status === 'done') {
          t.status = 'done';
          t.completed_at = nowIso();
          completedNow = true;
        } else if (patch.status === 'skipped') {
          if (t.status === 'done') return error(400, 'validation_failed', 'done task cannot be skipped', { issues: [{ path: 'status', message: 'done task cannot be skipped' }] });
          t.status = 'skipped';
        } else {
          if (t.status === 'expired' && t.due_date < today) t.due_date = today;
          t.status = 'pending';
          t.completed_at = null;
        }
      }
      if (patch.result_ref) t.result_ref = { ...(t.result_ref ?? {}), ...patch.result_ref, source: 'manual' };
      if (completedNow && ['vocab_review', 'review_errors', 'lesson', 'grammar', 'dictation', 'shadowing'].includes(t.task_type) && !patch.result_ref?.attempt_id) {
        if (awardXp(u.id, 'plan_task_done', XP_TABLE.plan_task_done, t.id)) recordStudyDay(u);
      }
      persist();
      emitTo(state, u.id, 'plan.updated', { task_id: t.id, reason: 'task_updated' });
      return json(200, taskDto(t, today));
    }),
    route('POST', '/me/plan/checkin', ({ body }) => {
      const u = requireUser();
      if (u instanceof Response) return u;
      const parsed = planCheckinInputSchema.safeParse(body);
      if (!parsed.success) return error(400, 'validation_failed', 'Invalid check-in', { issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
      const p = state.plans[u.id];
      if (!p) return error(404, 'not_found', 'study_plan not found');
      const today = todayOf(u);
      const idx = weekIndex(p, today);
      const cur = p.weeks[idx]!;
      const next = p.weeks[idx + 1] ?? null;
      const inp = parsed.data;
      cur.checkin_done_at = nowIso();
      for (const t of p.tasks) if (t.week_id === cur.id && t.task_type === 'checkin' && (t.status === 'pending' || t.status === 'expired')) {
        t.status = 'done';
        t.completed_at = nowIso();
        t.result_ref = { source: 'checkin' };
      }
      const xp = awardXp(u.id, 'checkin_submitted', XP_TABLE.checkin_submitted, cur.id);
      const text = `${inp.difficulties ?? ''} ${inp.availability_next_week?.note ?? ''}`;
      const blocked = /ignore (all )?previous instructions/i.test(text);
      const hours = /(\d+(?:[.,]\d+)?)\s*(giờ|gio|h\b|hours?)/i.exec(blocked ? '' : text);
      const maxMinutes = inp.availability_next_week?.minutes ?? (hours ? Math.round(Number(hours[1]!.replace(',', '.')) * 60) : null);
      let adjust: { proposal_id: string; status: PlanAdjustProposal['status'] } | null = null;
      if (next) {
        for (const r of Object.values(state.proposals)) if (r.plan_id === p.id && r.week?.id === next.id && r.source === 'checkin' && ['pending', 'ready', 'needs_clarification', 'rejected', 'failed'].includes(r.status)) r.status = 'superseded';
        const vi = localeOf(u) === 'vi';
        const summary = maxMinutes !== null ? (vi ? `Giảm tải tuần tới xuống tối đa ${maxMinutes} phút theo thời gian bạn khai báo.` : `Reduce next week to at most ${maxMinutes} minutes based on your availability.`) : vi ? 'Giữ nguyên tuần tới – bạn đang theo kịp kế hoạch.' : 'Keep next week as planned – you are on track.';
        const r = buildProposal(u, p, next, 'checkin', { maxMinutes, summary });
        state.proposals[r.id] = r;
        adjust = { proposal_id: r.id, status: 'pending' };
        scheduleSettle(900);
      }
      persist();
      const week = weekDto(p, cur, today, false);
      return json(200, { ...week, adjust, xp_earned: xp, difficulties_used: !!inp.difficulties?.trim() && !blocked });
    }),
    route('GET', '/me/plan/adjust', ({ url }) => {
      const u = requireUser();
      if (u instanceof Response) return u;
      settleProposals();
      const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') ?? 10) || 10));
      const data = Object.values(state.proposals)
        .filter((r) => r.user_id === u.id)
        .sort((x, y) => y.created_at.localeCompare(x.created_at))
        .slice(0, limit)
        .map(proposalDto);
      return json(200, { data });
    }),
    route('POST', '/me/plan/adjust', ({ body }) => {
      const u = requireUser();
      if (u instanceof Response) return u;
      const b = (body ?? {}) as { program?: string; instruction?: string };
      const instruction = (b.instruction ?? '').trim();
      if (instruction.length < 2 || instruction.length > 500) return error(400, 'validation_failed', 'Invalid instruction', { issues: [{ path: 'instruction', message: 'length' }] });
      const p = state.plans[u.id];
      if (!p) return error(404, 'not_found', 'study_plan not found');
      if (/ignore (all )?previous instructions/i.test(instruction)) return error(400, 'validation_failed', 'instruction refused by guard', { issues: [{ path: 'instruction', message: 'instruction refused by guard' }], refusal_code: 'injection' });
      const COST = 2;
      const balance = state.credits[u.id] ?? 0;
      if (balance < COST) return error(402, 'insufficient_credits', 'Not enough credits', { required: COST, balance });
      state.credits[u.id] = balance - COST;
      const today = todayOf(u);
      const idx = weekIndex(p, today);
      const vi = localeOf(u) === 'vi';
      const hours = /(\d+(?:[.,]\d+)?)\s*(giờ|gio|h\b|hours?)/i.exec(instruction);
      const nextWeekHint = /(tuần (tới|sau)|next week)/i.test(instruction);
      const week = (nextWeekHint ? p.weeks[idx + 1] : p.weeks[idx]) ?? p.weeks[idx]!;
      const dayMap: Record<string, string> = { 'thứ hai': 'mon', 'thứ ba': 'tue', 'thứ tư': 'wed', 'thứ năm': 'thu', 'thứ sáu': 'fri', 'thứ bảy': 'sat', 'chủ nhật': 'sun', monday: 'mon', tuesday: 'tue', wednesday: 'wed', thursday: 'thu', friday: 'fri', saturday: 'sat', sunday: 'sun' };
      const dayHit = Object.entries(dayMap).find(([k]) => instruction.toLowerCase().includes(k));
      const moveFrom = dayHit ? (week.study_dates.find((x) => weekdayOf(x) === dayHit[1]) ?? null) : null;
      const maxMinutes = hours ? Math.round(Number(hours[1]!.replace(',', '.')) * 60) : null;
      const clarify = maxMinutes === null && !moveFrom ? (vi ? 'Bạn muốn giảm còn bao nhiêu giờ, hay dời việc của ngày nào?' : 'How many hours should the week be, or which day should move?') : null;
      const summary = clarify ? (vi ? 'Cần thêm thông tin để điều chỉnh.' : 'More detail needed to adjust.') : vi ? `Điều chỉnh tuần ${week.week_no} theo yêu cầu của bạn.` : `Adjust week ${week.week_no} as requested.`;
      const r = buildProposal(u, p, week, 'instruction', { maxMinutes, moveFrom, summary, clarify });
      state.proposals[r.id] = r;
      persist();
      scheduleSettle(900);
      return json(202, proposalDto(r));
    }),
    route('POST', '/me/plan/adjust/{proposalId}/apply', ({ params }) => {
      const u = requireUser();
      if (u instanceof Response) return u;
      settleProposals();
      const r = state.proposals[params.proposalId!];
      if (!r) return error(404, 'not_found', 'plan_adjustment not found');
      if (r.user_id !== u.id) return error(403, 'forbidden', 'Not your proposal');
      const p = state.plans[u.id];
      const week = p?.weeks.find((w) => w.id === r.week?.id);
      if (!p || !week) return error(409, 'conflict', 'Plan changed', { status: 'superseded', violations: [] });
      const dto = proposalDto(r);
      if (r.status === 'applied') return json(200, { proposal: dto, week: weekDto(p, week, todayOf(u), false) });
      if (dto.status !== 'ready') return error(409, 'conflict', 'Proposal is not ready', { status: dto.status, violations: r.violations });
      for (const c of r.patch) {
        const t = p.tasks.find((x) => x.id === c.task_id);
        if (!t || t.status !== 'pending') continue;
        if (c.status) t.status = c.status;
        if (c.due_date) t.due_date = c.due_date;
        if (c.est_minutes) t.est_minutes = c.est_minutes;
        t.evidence_code = 'plan_adjust';
      }
      week.adjustment = { proposal_id: r.id, applied_at: nowIso() };
      r.status = 'applied';
      r.applied_at = nowIso();
      persist();
      emitTo(state, u.id, 'plan.updated', { proposal_id: r.id, reason: 'adjusted' });
      return json(200, { proposal: proposalDto(r), week: weekDto(p, week, todayOf(u), false) });
    }),
    route('GET', '/me/badges', () => {
      const u = requireUser();
      if (u instanceof Response) return u;
      const f = badgeFacts(u);
      const mine = state.badges[u.id] ?? {};
      const data: Badge[] = BADGES.map((b) => {
        const ev = evalRule(b.rule, f);
        return { code: b.code, name: b.name, rule: b.rule, earned: !!mine[b.code], earned_at: mine[b.code] ?? null, progress: ev.progress };
      });
      return json(200, { data, earned_count: Object.keys(mine).length });
    }),
    route('GET', '/lessons/{lessonId}', ({ params }) => (params.lessonId === MOCK_LESSON.id ? json(200, MOCK_LESSON) : error(404, 'not_found', 'lesson not found'))),
    route('GET', '/vocab/lists/{listId}/items', ({ params }) => {
      if (params.listId !== MOCK_VOCAB_LIST.id) return error(404, 'not_found', 'vocab list not found');
      const data = MOCK_DICTIONARY.slice(0, 10).map((e, i) => ({ id: e.id, kind: 'word', headword: e.headword, reading: null, sino_vietnamese: null, pos: e.pos, ipa_uk: e.ipa_uk, ipa_us: e.ipa_us, audio_uk_url: null, audio_us_url: null, meanings: e.meanings, examples: e.examples, collocations: e.collocations, level: e.level, topics: e.topics, sort_order: i + 1, srs: null }));
      return json(200, { data, next_cursor: null });
    }),
    // S10 (chưa có sổ lỗi ở mock): không còn lỗi chưa hiểu → 404 như API
    route('POST', '/me/errors/drill', () => error(404, 'not_found', 'No open errors')),
  ];

  return { routes, onAttemptGraded, statsExtras, createSectionAttempt, merge, questions: MOCK_DIAGNOSTIC_QUESTIONS };
}
