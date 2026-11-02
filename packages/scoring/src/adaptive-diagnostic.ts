/**
 * Bài chẩn đoán đầu vào v1 – thích ứng theo QUY TẮC (ADR-0031, Sprint 9). CAT/IRT thật ở GĐ4.
 *
 * - Ngân hàng: các câu của test set `kind = diagnostic` (≈ 60 câu, 2 mức khó mỗi Part/subskill). Đơn vị phục vụ = một câu
 *   (Part không có passage) hoặc TRỌN một nhóm passage (giữ nhóm: các câu cùng `group_key` phục vụ liền nhau).
 * - Mức khó 2 bậc theo kỹ năng: 1 = dễ, 2 = khó. Bắt đầu ở mức 1; ĐÚNG 2 câu liên tiếp → tăng mức, SAI 2 câu liên tiếp →
 *   giảm mức (chuỗi đếm lại sau mỗi lần đổi mức). Đơn vị kế tiếp ưu tiên đúng mức hiện tại, rồi subskill ít được đo nhất.
 * - Dừng khi đủ hạn mức đơn vị của mọi Part trong blueprint (hoặc hết câu) – ≈ 30 câu ≈ 25–30 phút với TOEIC.
 * - Kết quả: điểm ước tính theo kỹ năng ± khoảng (từ độ phân tán điểm từng câu), mastery 0–1 theo subskill, gợi ý mục tiêu.
 *
 * Mọi hàm THUẦN (không I/O) – API giữ trạng thái trong `learn.attempts.draft_state.adaptive`. Điểm là ƯỚC TÍNH.
 */
import { TOEIC_PART_SKILL, toeicScaled, type ToeicSkill } from './index.js';

export type DiagnosticLevel = 1 | 2;

export interface DiagnosticItem {
  question_id: string;
  section_code: string;
  /** listening | reading | … (TOEIC suy từ Part) */
  skill: string;
  group_key: string | null;
  subskills: string[];
  /** catalog.questions.difficulty_target (A2/B1/B2…); null = coi như B1 */
  difficulty: string | null;
  /** Thứ tự trong đề (tie-break ổn định) */
  order: number;
}

export interface DiagnosticBlueprintEntry {
  section_code: string;
  /** Số đơn vị phục vụ: câu lẻ hoặc nhóm passage */
  units: number;
}

/** Blueprint TOEIC L&R v1: ≈ 31 câu (P1 2, P2 4, P3 2 nhóm, P4 1 nhóm, P5 8, P6 1 nhóm, P7 2 nhóm) */
export const TOEIC_DIAGNOSTIC_BLUEPRINT: readonly DiagnosticBlueprintEntry[] = [
  { section_code: 'part1', units: 2 },
  { section_code: 'part2', units: 4 },
  { section_code: 'part3', units: 2 },
  { section_code: 'part4', units: 1 },
  { section_code: 'part5', units: 8 },
  { section_code: 'part6', units: 1 },
  { section_code: 'part7', units: 2 },
];

/** Số câu đúng/sai liên tiếp để đổi mức */
export const DIAGNOSTIC_STEP_RUN = 2;

const RANK: Record<string, number> = { A1: 0, A2: 1, B1: 2, B2: 3, C1: 4, C2: 5 };
const rankOf = (d: string | null): number => RANK[d ?? 'B1'] ?? 2;

/**
 * Mức của một đơn vị: câu lẻ A1/A2 → 1, từ B1 trở lên → 2; nhóm passage có câu từ B2 trở lên → 2, còn lại → 1
 * (nhóm thường trộn A2/B1 – câu B2 quyết định độ khó của bài nghe/đọc).
 */
export function unitLevel(items: readonly Pick<DiagnosticItem, 'difficulty' | 'group_key'>[]): DiagnosticLevel {
  if (items.length === 0) return 1;
  const grouped = items.length > 1 || items[0]!.group_key !== null;
  const max = Math.max(...items.map((i) => rankOf(i.difficulty)));
  return grouped ? (max >= RANK.B2! ? 2 : 1) : max >= RANK.B1! ? 2 : 1;
}

export interface DiagnosticUnit {
  key: string;
  section_code: string;
  skill: string;
  level: DiagnosticLevel;
  items: DiagnosticItem[];
  subskills: string[];
  order: number;
}

export type DiagnosticPool = Map<string, DiagnosticUnit[]>;

/** Gom câu thành đơn vị theo Part (nhóm passage giữ thứ tự trong đề) */
export function buildDiagnosticPool(items: readonly DiagnosticItem[]): DiagnosticPool {
  const byUnit = new Map<string, DiagnosticItem[]>();
  for (const it of [...items].sort((a, b) => a.order - b.order)) {
    const key = it.group_key ? `${it.section_code}:${it.group_key}` : `${it.section_code}:q:${it.question_id}`;
    const list = byUnit.get(key) ?? [];
    list.push(it);
    byUnit.set(key, list);
  }
  const pool: DiagnosticPool = new Map();
  for (const [key, list] of byUnit) {
    const first = list[0]!;
    const unit: DiagnosticUnit = { key, section_code: first.section_code, skill: first.skill, level: unitLevel(list), items: list, subskills: [...new Set(list.flatMap((i) => i.subskills))], order: first.order };
    const arr = pool.get(first.section_code) ?? [];
    arr.push(unit);
    pool.set(first.section_code, arr);
  }
  return pool;
}

export interface DiagnosticServed {
  question_id: string;
  section_code: string;
  skill: string;
  level: DiagnosticLevel;
  group_key: string | null;
  subskills: string[];
  /** null = đang chờ trả lời */
  correct: boolean | null;
}

export interface DiagnosticState {
  v: 1;
  levels: Record<string, DiagnosticLevel>;
  run: Record<string, { correct: number; wrong: number }>;
  served: DiagnosticServed[];
  /** Câu đang chờ trả lời */
  current: string | null;
  /** Câu còn lại của nhóm passage đang làm */
  queue: string[];
  /** Số đơn vị đã phục vụ theo Part */
  units: Record<string, number>;
  done: boolean;
  /** Tổng số câu dự kiến (ước lượng cho thanh tiến độ) */
  planned: number;
}

export class DiagnosticRuleError extends Error {
  constructor(
    readonly code: 'not_current' | 'already_done' | 'unknown_question',
    message: string,
  ) {
    super(message);
    this.name = 'DiagnosticRuleError';
  }
}

/** Ước lượng số câu sẽ phục vụ (trung bình kích thước đơn vị × hạn mức) */
export function plannedQuestions(pool: DiagnosticPool, blueprint: readonly DiagnosticBlueprintEntry[]): number {
  let n = 0;
  for (const b of blueprint) {
    const units = pool.get(b.section_code) ?? [];
    if (!units.length) continue;
    const avg = units.reduce((s, u) => s + u.items.length, 0) / units.length;
    n += Math.round(Math.min(b.units, units.length) * avg);
  }
  return n;
}

export function initDiagnosticState(pool: DiagnosticPool, blueprint: readonly DiagnosticBlueprintEntry[]): DiagnosticState {
  const skills = new Set<string>();
  for (const units of pool.values()) for (const u of units) skills.add(u.skill);
  const levels: Record<string, DiagnosticLevel> = {};
  const run: Record<string, { correct: number; wrong: number }> = {};
  for (const s of skills) {
    levels[s] = 1;
    run[s] = { correct: 0, wrong: 0 };
  }
  return { v: 1, levels, run, served: [], current: null, queue: [], units: {}, done: false, planned: plannedQuestions(pool, blueprint) };
}

/** Cập nhật chuỗi đúng/sai và mức của kỹ năng sau một câu (luật 2 liên tiếp) */
export function applyRunRule(level: DiagnosticLevel, run: { correct: number; wrong: number }, correct: boolean): { level: DiagnosticLevel; run: { correct: number; wrong: number } } {
  const next = correct ? { correct: run.correct + 1, wrong: 0 } : { correct: 0, wrong: run.wrong + 1 };
  // Đã ở mức trần/sàn vẫn đếm lại chuỗi (không cộng dồn sang lần đổi mức sau)
  if (next.correct >= DIAGNOSTIC_STEP_RUN) return { level: 2, run: { correct: 0, wrong: 0 } };
  if (next.wrong >= DIAGNOSTIC_STEP_RUN) return { level: 1, run: { correct: 0, wrong: 0 } };
  return { level, run: next };
}

/**
 * Một bước: ghi kết quả câu hiện tại (nếu có) rồi chọn câu kế tiếp. Không đổi `state` đầu vào (trả bản mới).
 * - `answer.question_id` phải là câu đang chờ (`not_current` nếu không).
 * - Đang dở nhóm passage → câu kế tiếp của nhóm (không đổi nhóm giữa chừng dù mức đã đổi).
 */
export function diagnosticAdvance(
  pool: DiagnosticPool,
  blueprint: readonly DiagnosticBlueprintEntry[],
  input: DiagnosticState,
  answer?: { question_id: string; correct: boolean },
): { state: DiagnosticState; next: string | null } {
  const state: DiagnosticState = structuredClone(input);
  if (answer) {
    if (state.done) throw new DiagnosticRuleError('already_done', 'diagnostic already finished');
    if (state.current !== answer.question_id) throw new DiagnosticRuleError('not_current', 'answer is not for the current question');
    const served = state.served.find((s) => s.question_id === answer.question_id && s.correct === null);
    if (!served) throw new DiagnosticRuleError('unknown_question', 'question was not served');
    served.correct = answer.correct;
    const skill = served.skill;
    const r = applyRunRule(state.levels[skill] ?? 1, state.run[skill] ?? { correct: 0, wrong: 0 }, answer.correct);
    state.levels[skill] = r.level;
    state.run[skill] = r.run;
    state.current = null;
  }
  if (state.done) return { state, next: null };
  if (state.current) return { state, next: state.current };

  const itemById = new Map<string, { item: DiagnosticItem; unit: DiagnosticUnit }>();
  for (const units of pool.values()) for (const u of units) for (const it of u.items) itemById.set(it.question_id, { item: it, unit: u });

  const serve = (id: string) => {
    const hit = itemById.get(id)!;
    state.served.push({ question_id: id, section_code: hit.item.section_code, skill: hit.item.skill, level: hit.unit.level, group_key: hit.item.group_key, subskills: hit.item.subskills, correct: null });
    state.current = id;
  };

  if (state.queue.length) {
    serve(state.queue.shift()!);
    return { state, next: state.current };
  }

  const servedIds = new Set(state.served.map((s) => s.question_id));
  const coverage = new Map<string, number>();
  for (const s of state.served) for (const sub of s.subskills) coverage.set(sub, (coverage.get(sub) ?? 0) + 1);
  for (const b of blueprint) {
    if ((state.units[b.section_code] ?? 0) >= b.units) continue;
    const free = (pool.get(b.section_code) ?? []).filter((u) => u.items.every((i) => !servedIds.has(i.question_id)));
    if (!free.length) continue;
    const skill = free[0]!.skill;
    const level = state.levels[skill] ?? 1;
    const score = (u: DiagnosticUnit) => u.subskills.reduce((s, sub) => s + (coverage.get(sub) ?? 0), 0) / Math.max(1, u.subskills.length);
    const pick = (list: DiagnosticUnit[]) => [...list].sort((a, b2) => score(a) - score(b2) || a.order - b2.order)[0];
    const unit = pick(free.filter((u) => u.level === level)) ?? pick(free)!;
    state.units[b.section_code] = (state.units[b.section_code] ?? 0) + 1;
    const [first, ...rest] = unit.items.map((i) => i.question_id);
    state.queue = rest;
    serve(first!);
    return { state, next: state.current };
  }
  state.done = true;
  state.current = null;
  return { state, next: null };
}

// ----------------------------------------------------------------------------- kết quả

/** Điểm một câu theo (mức, đúng/sai): đúng câu khó 0,9 · đúng câu dễ 0,65 · sai câu khó 0,35 · sai câu dễ 0,1 */
export function diagnosticItemScore(level: DiagnosticLevel, correct: boolean): number {
  if (level === 2) return correct ? 0.9 : 0.35;
  return correct ? 0.65 : 0.1;
}

export interface DiagnosticSkillEstimate {
  score: number;
  low: number;
  high: number;
  /** Năng lực 0–1 (trung bình điểm từng câu, quy về 0–1) */
  ability: number;
  n: number;
  correct: number;
}

export interface DiagnosticEstimate {
  by_skill: Record<string, DiagnosticSkillEstimate>;
  total: { score: number; low: number; high: number } | null;
  /** Sai số chuẩn (điểm) của tổng – OpenAPI `estimate.se` */
  se: number | null;
  answered: number;
  estimated: true;
}

/** Nửa độ rộng tối thiểu (điểm) của khoảng ước tính chẩn đoán: kỹ năng 35, tổng 50 – bài ngắn nên rộng hơn đề full (±25) */
export const DIAGNOSTIC_MIN_HALF_WIDTH = { skill: 35, total: 50 } as const;

const round5 = (x: number) => Math.round(x / 5) * 5;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/**
 * Ước tính điểm TOEIC L&R từ các câu đã trả lời: năng lực θ (0,1–0,9) → % đúng tương đương p = (θ − 0,1)/0,8 → thang
 * quy đổi Allingo (`toeicScaled`). Khoảng = p ± 1,96·SE(θ)/0,8 quy đổi, tối thiểu ±35 mỗi kỹ năng, tổng = căn tổng bình phương
 * (tối thiểu ±50). Kỹ năng không có câu → không có trong by_skill, tổng null.
 */
export function estimateToeicDiagnostic(served: readonly DiagnosticServed[]): DiagnosticEstimate {
  const answered = served.filter((s) => s.correct !== null);
  const by_skill: Record<string, DiagnosticSkillEstimate> = {};
  const halfWidths: number[] = [];
  for (const skill of ['listening', 'reading'] as ToeicSkill[]) {
    const list = answered.filter((s) => (TOEIC_PART_SKILL[s.section_code] ?? s.skill) === skill);
    if (!list.length) continue;
    const xs = list.map((s) => diagnosticItemScore(s.level, !!s.correct));
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const variance = xs.length > 1 ? xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1) : 0.0625;
    const se = Math.sqrt(variance / xs.length);
    const p = clamp((mean - 0.1) / 0.8, 0, 1);
    const dp = (1.96 * se) / 0.8;
    const score = toeicScaled(skill, p * 100);
    const lowS = toeicScaled(skill, clamp(p - dp, 0, 1) * 100);
    const highS = toeicScaled(skill, clamp(p + dp, 0, 1) * 100);
    const hw = Math.max(DIAGNOSTIC_MIN_HALF_WIDTH.skill, round5((highS - lowS) / 2));
    halfWidths.push(hw);
    by_skill[skill] = { score, low: clamp(score - hw, 5, 495), high: clamp(score + hw, 5, 495), ability: Math.round(p * 1000) / 1000, n: list.length, correct: list.filter((s) => s.correct).length };
  }
  const L = by_skill.listening;
  const R = by_skill.reading;
  let total: DiagnosticEstimate['total'] = null;
  let se: number | null = null;
  if (L && R) {
    const score = L.score + R.score;
    const hw = Math.max(DIAGNOSTIC_MIN_HALF_WIDTH.total, round5(Math.sqrt(halfWidths.reduce((a, b) => a + b * b, 0))));
    total = { score, low: clamp(score - hw, 10, 990), high: clamp(score + hw, 10, 990) };
    se = Math.round(hw / 1.96);
  }
  return { by_skill, total, se, answered: answered.length, estimated: true };
}

export interface SubskillMastery {
  subskill: string;
  skill: string;
  sections: string[];
  /** 0–1 */
  mastery: number;
  /** 0–1: n/(n+2) */
  confidence: number;
  n_obs: number;
}

/** Mastery khởi tạo theo subskill = trung bình điểm từng câu (diagnosticItemScore) của các câu đo subskill đó */
export function masteryFromDiagnostic(served: readonly DiagnosticServed[]): SubskillMastery[] {
  const acc = new Map<string, { skill: string; sections: Set<string>; xs: number[] }>();
  for (const s of served) {
    if (s.correct === null) continue;
    for (const sub of s.subskills) {
      const cur = acc.get(sub) ?? { skill: s.skill, sections: new Set<string>(), xs: [] };
      cur.sections.add(s.section_code);
      cur.xs.push(diagnosticItemScore(s.level, s.correct));
      acc.set(sub, cur);
    }
  }
  return [...acc.entries()]
    .map(([subskill, v]) => {
      const mean = v.xs.reduce((a, b) => a + b, 0) / v.xs.length;
      return { subskill, skill: v.skill, sections: [...v.sections].sort(), mastery: Math.round(clamp(mean, 0, 1) * 10_000) / 10_000, confidence: Math.round((v.xs.length / (v.xs.length + 2)) * 10_000) / 10_000, n_obs: v.xs.length };
    })
    .sort((a, b) => a.subskill.localeCompare(b.subskill));
}

// ----------------------------------------------------------------------------- mục tiêu khả thi

/** Điểm TOEIC tăng ước tính mỗi GIỜ học hiệu quả theo mức hiện tại (quy tắc nội bộ – hiệu chỉnh bằng dữ liệu GĐ1) */
export function toeicGainPerHour(score: number): number {
  if (score < 400) return 6;
  if (score < 600) return 4.5;
  if (score < 750) return 3;
  if (score < 850) return 2;
  return 1;
}

/** Hiệu suất thực tế: người học hoàn thành trung bình ~ 75 % kế hoạch */
export const PLAN_ADHERENCE = 0.75;
/** Không có ngày thi → tầm nhìn mặc định 8 tuần */
export const DEFAULT_HORIZON_WEEKS = 8;

export interface TargetSuggestion {
  current: number;
  suggested: number;
  desired: number | null;
  feasible: boolean | null;
  weeks_left: number;
  weekly_minutes: number;
  /** Phút/tuần cần để đạt `desired` trước ngày thi (null khi đã khả thi / không đạt nổi với ≤ 35 giờ/tuần) */
  required_weekly_minutes: number | null;
  reason: 'feasible' | 'stretch' | 'unreachable' | 'no_exam_date' | 'no_target';
}

const daysBetween = (fromIso: string, toIso: string) => Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);

function projectToeic(current: number, weeks: number, weeklyMinutes: number): number {
  let s = current;
  for (let w = 0; w < weeks; w++) s = Math.min(990, s + (weeklyMinutes / 60) * PLAN_ADHERENCE * toeicGainPerHour(s));
  return s;
}

/**
 * Gợi ý mục tiêu TOEIC khả thi tới ngày thi: mô phỏng từng tuần với tốc độ tăng theo mức (`toeicGainPerHour`) × số giờ/tuần ×
 * độ tuân thủ 75 %. `desired` > gợi ý → `feasible = false` + số phút/tuần cần (tìm theo bước 30 phút, tối đa 35 giờ).
 */
export function suggestToeicTarget(input: { current: number; today: string; examDate: string | null; weeklyMinutes: number; desired?: number | null }): TargetSuggestion {
  const weeks = input.examDate ? Math.max(0, Math.floor(daysBetween(input.today, input.examDate) / 7)) : DEFAULT_HORIZON_WEEKS;
  const suggested = clamp(round5(projectToeic(input.current, weeks, input.weeklyMinutes)), 10, 990);
  const desired = input.desired ?? null;
  let feasible: boolean | null = null;
  let required: number | null = null;
  let reason: TargetSuggestion['reason'] = input.examDate ? 'no_target' : 'no_exam_date';
  if (desired !== null) {
    feasible = desired <= suggested;
    if (feasible) reason = 'feasible';
    else {
      for (let m = input.weeklyMinutes + 30; m <= 2100; m += 30) {
        if (projectToeic(input.current, weeks, m) >= desired) {
          required = m;
          break;
        }
      }
      reason = required !== null ? 'stretch' : 'unreachable';
    }
  }
  return { current: input.current, suggested, desired, feasible, weeks_left: weeks, weekly_minutes: input.weeklyMinutes, required_weekly_minutes: required, reason };
}
