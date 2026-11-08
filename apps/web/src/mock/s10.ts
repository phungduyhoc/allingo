import { correctAnswerOf, grade, isAnswered, type AttemptMode, type Forecast, type Stats } from '@allingo/schemas';
import { MOCK_DICTIONARY, type MockDictEntry } from './dictionary';
import { MOCK_SUBSKILL_OF_TAG, type MockQuestion } from './fixtures';
import { MOCK_VOCAB_LIST } from './learning-plan';
import type { MockAttemptRecord, MockErrorRecord, MockSrsRecord, MockState, MockUserRecord } from './state';

/**
 * Mock Sprint 10 – bám hợp đồng `packages/schemas/src/api/learning-s10.ts`: ôn thẻ (lịch giản lược kiểu FSRS: Again 1′ / Hard 5′
 * trong phiên, Good 1 ngày, Easy 4 ngày; hạn mức thẻ mới/ngày áp khi HỌC – Free 10/Pro 30; idempotent theo (card_id, reviewed_at)),
 * bộ từ hệ thống (từ điển mẫu 20 từ tự biên soạn), sổ lỗi (tạo khi chấm bài – luật timeout/subskill như ADR-0033), drill từ lỗi,
 * thống kê S10 + dự báo v0 (hồi quy tuyến tính), sự kiện phễu (chỉ nhận khi consent = true) và đăng ký chờ. Không dùng ở production.
 */

type Json = (status: number, body: unknown, headers?: Record<string, string>) => Response;
type Err = (status: number, code: string, message: string, details?: Record<string, unknown>) => Response;
type Handler = (ctx: { url: URL; params: Record<string, string>; body: unknown; method: string; locale: string; headers: Headers }) => Promise<Response> | Response;

export interface S10Deps<R> {
  state: MockState;
  persist: () => void;
  route: (method: string, path: string, handler: Handler) => R;
  json: Json;
  error: Err;
  uuid: () => string;
  nowIso: () => string;
  requireUser: () => MockUserRecord | Response;
  isPro: (u: MockUserRecord) => boolean;
  quotaExceeded: (u: MockUserRecord, feature: string) => Response | null;
  consumeQuota: (u: MockUserRecord, feature: string) => void;
  quotaLimit: (u: MockUserRecord, feature: string) => number | null;
  usage: (userId: string, feature: string) => number;
  resetAt: (period: string) => string;
  questionById: (id: string) => MockQuestion | undefined;
  publicQuestion: (q: MockQuestion) => unknown;
  toAttemptDto: (a: MockAttemptRecord) => unknown;
  openExamId: (userId: string) => string | null;
}

// ----------------------------------------------------------------------------- bộ từ mẫu
const lid = (n: number) => `00000000-0000-4000-8000-${String(970000000000 + n).padStart(12, '0')}`;
export const MOCK_S10_LISTS: Array<{ id: string; title: { vi: string; en: string }; kind: string; topic: string | null; is_free: boolean; sort_order: number; words: string[] }> = [
  { id: MOCK_VOCAB_LIST.id, title: MOCK_VOCAB_LIST.title, kind: 'core', topic: null, is_free: true, sort_order: 1, words: MOCK_DICTIONARY.slice(0, 10).map((e) => e.id) },
  { id: lid(1), title: { vi: 'TOEIC 600 từ theo chủ đề – trọn bộ (mẫu)', en: 'TOEIC 600 words by topic – full set (sample)' }, kind: 'core', topic: null, is_free: true, sort_order: 10, words: MOCK_DICTIONARY.map((e) => e.id) },
  { id: lid(2), title: { vi: 'TOEIC 600 – Văn phòng (mẫu)', en: 'TOEIC 600 – Office (sample)' }, kind: 'topic', topic: 'office', is_free: true, sort_order: 11, words: MOCK_DICTIONARY.filter((e) => e.topics.includes('office')).map((e) => e.id) },
  { id: lid(3), title: { vi: 'TOEIC 600 – Kinh doanh (mẫu)', en: 'TOEIC 600 – Business (sample)' }, kind: 'topic', topic: 'business', is_free: true, sort_order: 12, words: MOCK_DICTIONARY.slice(10).map((e) => e.id) },
];

const MIN = 60_000;
const DAY = 86_400_000;
const IN_SESSION_MS = 20 * MIN;
const MASTERED_DAYS = 21;

function vocabPayload(e: MockDictEntry): Record<string, unknown> {
  return {
    vocab_item_id: e.id,
    headword: e.headword,
    pos: e.pos,
    ipa: e.ipa_us,
    ipa_us: e.ipa_us,
    ipa_uk: e.ipa_uk,
    meaning_local: e.meanings[0]?.vi ?? null,
    meaning_en: e.meanings[0]?.en ?? null,
    meanings_local: e.meanings.map((m) => m.vi),
    examples: e.examples.map((x) => ({ text: x.en, translation: x.vi })),
    collocations: e.collocations,
    level: e.level,
    topics: e.topics,
    source: 'human',
    tts_text: e.headword,
  };
}

/** Lịch sau một lượt chấm (thuần) – Again/Hard ở thẻ đang học quay lại trong phiên; review nhân khoảng theo độ ổn định */
export function scheduleMock(c: Pick<MockSrsRecord, 'state' | 'stability' | 'lapses'>, rating: 1 | 2 | 3 | 4, now: number): { state: MockSrsRecord['state']; due: number; stability: number; lapses: number } {
  const learning = c.state === 'new' || c.state === 'learning' || c.state === 'relearning';
  if (learning) {
    if (rating === 1) return { state: c.state === 'relearning' ? 'relearning' : 'learning', due: now + MIN, stability: 0.4, lapses: c.lapses };
    if (rating === 2) return { state: c.state === 'relearning' ? 'relearning' : 'learning', due: now + 5 * MIN, stability: 0.8, lapses: c.lapses };
    if (rating === 3) return { state: 'review', due: now + DAY, stability: 3, lapses: c.lapses };
    return { state: 'review', due: now + 4 * DAY, stability: 13, lapses: c.lapses };
  }
  const s = Math.max(1, c.stability ?? 1);
  if (rating === 1) return { state: 'relearning', due: now + 10 * MIN, stability: Math.max(0.5, s * 0.3), lapses: c.lapses + 1 };
  const mult = rating === 2 ? 1.2 : rating === 3 ? 2.5 : 3.5;
  const days = Math.min(365, Math.max(1, Math.round(s * mult)));
  return { state: 'review', due: now + days * DAY, stability: days, lapses: c.lapses };
}

/** Phân loại lỗi theo luật (như ErrorLogService v1): quá thời gian theo Part → subskill → Part */
export function classifyMockError(q: MockQuestion, timeSpentMs: number | null): { kind: string; subskill: string | null; rule: string; threshold_ms: number } {
  const threshold = q.section_code === 'part7' || q.section_code === 'part6' ? 90_000 : q.section_code === 'part3' || q.section_code === 'part4' ? 40_000 : 25_000;
  const subskill = (q.content.tags ?? []).map((t) => MOCK_SUBSKILL_OF_TAG[t]).find((x): x is string => !!x) ?? null;
  if (timeSpentMs !== null && timeSpentMs > threshold) return { kind: 'timeout', subskill, rule: 'timeout', threshold_ms: threshold };
  const bySub: Record<string, string> = {
    verb_tense: 'grammar',
    word_form: 'grammar',
    preposition: 'grammar',
    conjunction: 'grammar',
    pronoun: 'grammar',
    relative_clause: 'grammar',
    vocabulary_context: 'vocabulary',
    paraphrase_recognition: 'paraphrase',
    inference: 'inference',
    detail: 'other',
    indirect_response: 'trap',
    similar_sound: 'trap',
    wh_question: 'listening_detail',
    yes_no_question: 'listening_detail',
    listening_detail: 'listening_detail',
    listening_gist: 'inference',
  };
  if (subskill && bySub[subskill]) return { kind: bySub[subskill], subskill, rule: 'subskill', threshold_ms: threshold };
  const byPart: Record<string, string> = { part1: 'listening_detail', part2: 'trap', part3: 'listening_detail', part4: 'listening_detail', part5: 'grammar', part6: 'grammar', part7: 'inference' };
  return { kind: byPart[q.section_code] ?? 'other', subskill, rule: 'section', threshold_ms: threshold };
}

/** Hồi quy tuyến tính y = a + b·x (x = tuần) – dự báo v0 */
function linreg(points: Array<{ x: number; y: number }>): { a: number; b: number; resid: number } {
  const n = points.length;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  const sxx = points.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  const b = sxx > 0 ? points.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / sxx : 0;
  const a = my - b * mx;
  const resid = Math.sqrt(points.reduce((s, p) => s + (p.y - (a + b * p.x)) ** 2, 0) / Math.max(1, n - 2));
  return { a, b, resid };
}

const COMMUNITY_SAMPLE = [255, 310, 380, 420, 455, 500, 540, 585, 620, 680, 735, 805];
const round5 = (v: number) => Math.round(v / 5) * 5;
const clampScore = (v: number) => Math.max(10, Math.min(990, round5(v)));

export function s10Mock<R>(d: S10Deps<R>) {
  const { state, persist, route, json, error, uuid, nowIso, requireUser } = d;

  const migrateS6 = (u: MockUserRecord) => {
    let changed = false;
    for (const c of Object.values(state.srsCards)) {
      if (c.user_id !== u.id || state.srs[c.id]) continue;
      const e = MOCK_DICTIONARY.find((x) => x.id === c.ref_id);
      state.srs[c.id] = { id: c.id, user_id: u.id, card_type: 'vocab', ref_id: e?.id ?? c.id, state: 'new', due_at: c.created_at, stability: null, difficulty: null, reps: 0, lapses: 0, last_review_at: null, payload: e ? vocabPayload(e) : { headword: c.headword, tts_text: c.headword }, source_type: 'dictionary', created_at: c.created_at, list_ids: [] };
      changed = true;
    }
    if (changed) persist();
  };
  const cardsOf = (u: MockUserRecord) => {
    migrateS6(u);
    return Object.values(state.srs).filter((c) => c.user_id === u.id);
  };

  const cardDto = (c: MockSrsRecord, now = Date.now(), extra: Record<string, unknown> = {}) => {
    const p = (r: 1 | 2 | 3 | 4) => new Date(scheduleMock(c, r, now).due).toISOString();
    return {
      id: c.id,
      card_type: c.card_type,
      ref_id: c.ref_id,
      state: c.state,
      due_at: c.due_at,
      stability: c.stability,
      difficulty: c.difficulty,
      reps: c.reps,
      lapses: c.lapses,
      payload: c.payload,
      last_review_at: c.last_review_at,
      source_type: c.source_type,
      suspended: false,
      mastered: c.state === 'review' && (c.stability ?? 0) >= MASTERED_DAYS,
      preview: { again: p(1), hard: p(2), good: p(3), easy: p(4) },
      ...extra,
    };
  };

  /** Cuối ngày hôm nay theo giờ VN (UTC+7) */
  const endOfVnDay = () => Date.parse(d.resetAt('day'));

  const newLimitOf = (u: MockUserRecord) => d.quotaLimit(u, 'srs_new_cards');
  const newUsed = (u: MockUserRecord) => d.usage(u.id, 'srs_new_cards');

  const listCounts = (u: MockUserRecord, words: string[]) => {
    const now = Date.now();
    const mine = cardsOf(u).filter((c) => c.card_type === 'vocab' && words.includes(c.ref_id));
    const mastered = mine.filter((c) => c.state === 'review' && (c.stability ?? 0) >= MASTERED_DAYS).length;
    return { total: words.length, new: mine.filter((c) => c.state === 'new').length, learning: mine.filter((c) => c.state !== 'new' && !(c.state === 'review' && (c.stability ?? 0) >= MASTERED_DAYS)).length, due: mine.filter((c) => c.state !== 'new' && Date.parse(c.due_at) <= now).length, mastered, enrolled: mine.length };
  };

  const listDto = (u: MockUserRecord, l: (typeof MOCK_S10_LISTS)[number], locale: string) => {
    const counts = listCounts(u, l.words);
    const code = counts.enrolled === 0 ? 'enroll' : counts.due > 0 ? 'review' : counts.new > 0 ? 'learn_new' : 'done';
    const vi = locale !== 'en';
    const label = code === 'enroll' ? (vi ? 'Thêm vào ôn tập' : 'Add to reviews') : code === 'review' ? (vi ? `Ôn ${counts.due}` : `Review ${counts.due}`) : code === 'learn_new' ? (vi ? `Học ${counts.new} từ mới` : `Learn ${counts.new} new`) : vi ? 'Đã xong' : 'Done';
    return { id: l.id, program: 'toeic', kind: l.kind, title: l.title, is_free: l.is_free, sort_order: l.sort_order, topic: l.topic, counts, enrolled: counts.enrolled > 0, next_action_code: code, next_action: label };
  };

  // ------------------------------------------------------------------ sổ lỗi
  const errorDto = (e: MockErrorRecord) => {
    const q = d.questionById(e.question_id);
    return {
      id: e.id,
      kind: e.reason_override ?? e.kind_auto,
      kind_auto: e.kind_auto,
      reason_auto: e.reason_auto,
      reason_override: e.reason_override,
      question: q ? d.publicQuestion(q) : null,
      question_id: e.question_id,
      question_version_id: e.question_version_id,
      section_code: e.section_code,
      subskill: e.subskill,
      topic: e.topic,
      your_answer: e.your_answer,
      correct_answer: e.correct_answer,
      time_spent_ms: e.time_spent_ms,
      occurrences: e.occurrences,
      note: e.note,
      resolved: e.resolved,
      resolved_at: e.resolved_at,
      srs_card_id: e.srs_card_id,
      attempt_id: e.attempt_id,
      created_at: e.created_at,
      last_seen_at: e.last_seen_at,
    };
  };

  /** Khi bài được chấm: mỗi câu sai/bỏ trống → mục sổ lỗi (gộp theo câu; sai lại ở lượt khác → mở lại, occurrences + 1) */
  const onAttemptGraded = (a: MockAttemptRecord, questions: MockQuestion[]) => {
    if (a.mode === 'diagnostic') return;
    const at = nowIso();
    for (const q of questions) {
      const rec = a.answers[q.question_id];
      const answered = !!rec && isAnswered(rec.answer);
      const g = grade(q.content, rec?.answer ?? null);
      if (g.is_correct === true) continue;
      const time = rec?.time_spent_ms ?? null;
      const cls = classifyMockError(q, time);
      const existing = Object.values(state.errorLog).find((e) => e.user_id === a.user_id && e.question_id === q.question_id);
      const yourAnswer = answered && rec ? ((rec.answer as { selected?: unknown }).selected ?? rec.answer) : null;
      if (existing) {
        if (existing.attempt_id === a.id) continue;
        Object.assign(existing, { attempt_id: a.id, occurrences: existing.occurrences + 1, last_seen_at: at, resolved: false, resolved_at: null, your_answer: yourAnswer, time_spent_ms: time, kind_auto: cls.kind, question_version_id: q.question_version_id });
        continue;
      }
      const id = uuid();
      state.errorLog[id] = {
        id,
        user_id: a.user_id,
        program: a.program,
        question_id: q.question_id,
        question_version_id: q.question_version_id,
        section_code: q.section_code,
        subskill: cls.subskill,
        topic: null,
        kind_auto: cls.kind,
        reason_override: null,
        reason_auto: { kind: cls.kind, rule: cls.rule, source: 'rule-v1', mode: a.mode, answered, question_type: q.content.type, evidence: { section: q.section_code, subskill: cls.subskill, threshold_ms: cls.threshold_ms, time_spent_ms: time } },
        your_answer: yourAnswer,
        correct_answer: correctAnswerOf(q.content),
        time_spent_ms: time,
        occurrences: 1,
        note: null,
        resolved: false,
        resolved_at: null,
        srs_card_id: null,
        attempt_id: a.id,
        created_at: at,
        last_seen_at: at,
      };
    }
  };

  const filterErrors = (u: MockUserRecord, url: URL, ignore: 'kind' | 'part' | null = null) => {
    const kind = url.searchParams.get('kind');
    const part = url.searchParams.get('part');
    const status = url.searchParams.get('status') ?? 'open';
    const sort = url.searchParams.get('sort') === 'oldest' ? 'oldest' : 'newest';
    const daysRaw = url.searchParams.get('days');
    const days = daysRaw === null ? (sort === 'oldest' ? 0 : 30) : Number(daysRaw);
    const since = days > 0 ? Date.now() - days * DAY : 0;
    return Object.values(state.errorLog)
      .filter((e) => e.user_id === u.id)
      .filter((e) => (status === 'all' ? true : status === 'resolved' ? e.resolved : !e.resolved))
      .filter((e) => !since || Date.parse(e.last_seen_at) >= since)
      .filter((e) => ignore === 'kind' || !kind || (e.reason_override ?? e.kind_auto) === kind)
      .filter((e) => ignore === 'part' || !part || e.section_code === part)
      .sort((x, y) => (sort === 'oldest' ? x.last_seen_at.localeCompare(y.last_seen_at) : y.last_seen_at.localeCompare(x.last_seen_at)) || x.id.localeCompare(y.id));
  };

  const errorCardFor = (u: MockUserRecord, e: MockErrorRecord): MockSrsRecord => {
    const existing = Object.values(state.srs).find((c) => c.user_id === u.id && c.card_type === 'error' && c.ref_id === e.id);
    if (existing) return existing;
    const q = d.questionById(e.question_id);
    const content = q?.content as { stem?: string; options?: Array<{ key: string; text: string }>; explanation?: { vi?: string; en?: string } } | undefined;
    const c: MockSrsRecord = {
      id: uuid(),
      user_id: u.id,
      card_type: 'error',
      ref_id: e.id,
      state: 'new',
      due_at: nowIso(),
      stability: null,
      difficulty: null,
      reps: 0,
      lapses: 0,
      last_review_at: null,
      payload: { error_entry_id: e.id, kind: e.reason_override ?? e.kind_auto, section_code: e.section_code, question_id: e.question_id, question_version_id: e.question_version_id, stem: content?.stem ?? '', options: content?.options ?? [], passage_excerpt: q?.passage?.kind === 'audio_script' ? null : (q?.passage?.body?.slice(0, 300) ?? null), correct_answer: e.correct_answer, explanation: content?.explanation?.vi ?? null, evidence: (q?.content as { evidence?: string } | undefined)?.evidence ?? null, note: e.note, occurrences: e.occurrences },
      source_type: 'error_log',
      created_at: nowIso(),
      list_ids: [],
    };
    state.srs[c.id] = c;
    return c;
  };

  // ------------------------------------------------------------------ thống kê S10
  const statsExtras = (u: MockUserRecord, program: string): Partial<Stats> => {
    const now = Date.now();
    const graded = Object.values(state.attempts)
      .filter((a) => a.user_id === u.id && a.result && a.program === program)
      .sort((x, y) => (x.submitted_at ?? '').localeCompare(y.submitted_at ?? ''));
    const score_history = graded
      .filter((a) => a.result?.scaled_score !== null && a.result?.scaled_score !== undefined)
      .map((a) => ({ date: (a.submitted_at ?? '').slice(0, 10), at: a.submitted_at ?? nowIso(), score: a.result!.scaled_score!, listening: a.result?.scaled?.listening ?? null, reading: a.result?.scaled?.reading ?? null, kind: a.mode === 'diagnostic' ? 'diagnostic' : 'mini', mode: a.mode, attempt_id: a.id }));
    const cell = () => ({ correct: 0, total: 0, accuracy: null as number | null });
    const bySection: Record<string, { current: ReturnType<typeof cell>; previous: ReturnType<typeof cell>; delta: number | null }> = {};
    const bySub: typeof bySection = {};
    const add = (map: typeof bySection, key: string, which: 'current' | 'previous', s: { correct: number; total: number }) => {
      const row = (map[key] ??= { current: cell(), previous: cell(), delta: null });
      row[which].correct += s.correct;
      row[which].total += s.total;
    };
    for (const a of graded) {
      const age = now - Date.parse(a.submitted_at ?? nowIso());
      const which = age <= 30 * DAY ? 'current' : age <= 60 * DAY ? 'previous' : null;
      if (!which) continue;
      for (const [k, s] of Object.entries(a.result?.by_section ?? {})) add(bySection, k, which, s);
      for (const [tag, s] of Object.entries(a.result?.by_subskill ?? {})) add(bySub, MOCK_SUBSKILL_OF_TAG[tag] ?? tag, which, s);
    }
    for (const map of [bySection, bySub])
      for (const row of Object.values(map)) {
        for (const c of [row.current, row.previous]) c.accuracy = c.total ? Math.round((c.correct / c.total) * 1000) / 10 : null;
        row.delta = row.current.accuracy !== null && row.previous.accuracy !== null ? Math.round((row.current.accuracy - row.previous.accuracy) * 10) / 10 : null;
      }
    const monday = (t: number) => {
      const v = new Date(t + 7 * 3_600_000);
      const day = (v.getUTCDay() + 6) % 7;
      return Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate() - day);
    };
    const thisWeek = monday(now);
    const cards = cardsOf(u);
    const reviewsAt = cards.filter((c) => c.last_review_at).map((c) => Date.parse(c.last_review_at!));
    const minutes_by_week = Array.from({ length: 8 }, (_, i) => {
      const start = thisWeek - (7 - i) * 7 * DAY;
      const end = start + 7 * DAY;
      const atts = graded.filter((a) => {
        const t = Date.parse(a.submitted_at ?? '') + 7 * 3_600_000;
        return t >= start && t < end;
      });
      const reviews = reviewsAt.filter((t) => t + 7 * 3_600_000 >= start && t + 7 * 3_600_000 < end).length;
      return { week_start: new Date(start).toISOString().slice(0, 10), minutes: atts.length * 8 + Math.round((reviews * 10) / 60), attempts: atts.length, reviews };
    });
    const vocabCards = cards.filter((c) => c.card_type === 'vocab');
    const errs = Object.values(state.errorLog).filter((e) => e.user_id === u.id);
    const byKind: Record<string, number> = {};
    for (const e of errs.filter((x) => !x.resolved)) byKind[e.reason_override ?? e.kind_auto] = (byKind[e.reason_override ?? e.kind_auto] ?? 0) + 1;
    const est = score_history.length ? score_history[score_history.length - 1]!.score : null;
    const percentile = est === null ? null : Math.round(((COMMUNITY_SAMPLE.filter((s) => s < est).length + COMMUNITY_SAMPLE.filter((s) => s === est).length / 2) / COMMUNITY_SAMPLE.length) * 1000) / 10;
    return {
      score_history,
      accuracy: { window_days: 30, by_section: bySection, by_subskill: bySub },
      minutes_by_week,
      vocab: { total: vocabCards.length, new: vocabCards.filter((c) => c.state === 'new').length, learning: vocabCards.filter((c) => c.state !== 'new' && !(c.state === 'review' && (c.stability ?? 0) >= MASTERED_DAYS)).length, mastered: vocabCards.filter((c) => c.state === 'review' && (c.stability ?? 0) >= MASTERED_DAYS).length, due_today: vocabCards.filter((c) => c.state !== 'new' && Date.parse(c.due_at) <= endOfVnDay()).length, reviews_7d: reviewsAt.filter((t) => now - t <= 7 * DAY).length },
      errors: { open: errs.filter((e) => !e.resolved).length, resolved: errs.filter((e) => e.resolved).length, by_kind: byKind },
      community: est === null ? { percentile: null, cohort_size: 0, target_bucket: null, reason: 'no_estimate' } : { percentile, cohort_size: COMMUNITY_SAMPLE.length, target_bucket: '600-795', reason: 'ok' },
      generated_at: nowIso(),
      cached: false,
      minutes_this_week: minutes_by_week[7]?.minutes ?? 0,
    };
  };

  const forecastOf = (u: MockUserRecord, program: string): Forecast => {
    const ex = statsExtras(u, program);
    const hist = ex.score_history ?? [];
    const enrollment = (state.enrollments[u.id] ?? []).find((e) => e.program === program);
    const target = enrollment?.target_score ?? null;
    const examDate = enrollment?.exam_date ?? null;
    const horizon = examDate ?? new Date(Date.now() + 30 * DAY).toISOString().slice(0, 10);
    const base = { computed_at: nowIso(), label: 'preliminary_estimate' as const, model_version: 'linreg-v0', target, exam_date: examDate, horizon_date: horizon, points_used: hist.length, scale: { min: 10, max: 990 } };
    if (!hist.length) return { ...base, predicted_score: null, ci_low: null, ci_high: null, ready_date: null, on_track: null, recommendation_code: 'need_data', recommendation: 'Làm một bài chẩn đoán hoặc đề mini để có điểm ước tính đầu tiên.', status: 'insufficient_data', current_estimate: null, slope_per_week: null };
    const t0 = Date.parse(hist[0]!.at);
    const pts = hist.map((h) => ({ x: (Date.parse(h.at) - t0) / (7 * DAY), y: h.score }));
    const current = hist[hist.length - 1]!.score;
    const weeks = (Date.parse(horizon) - t0) / (7 * DAY);
    const { a, b, resid } = pts.length >= 2 ? linreg(pts) : { a: current, b: 0, resid: 75 };
    const predicted = clampScore(pts.length >= 2 ? a + b * weeks : current);
    const spread = Math.max(40, Math.round(resid * 1.96));
    const onTrack = target === null ? null : predicted >= target;
    const ready = target !== null && b > 0 && current < target ? new Date(Date.now() + ((target - current) / b) * 7 * DAY).toISOString().slice(0, 10) : null;
    const code: Forecast['recommendation_code'] = target === null ? 'set_target' : current >= target ? 'target_reached' : onTrack ? 'on_track' : b > 0 ? 'keep_going' : 'increase_practice';
    return { ...base, predicted_score: predicted, ci_low: clampScore(predicted - spread), ci_high: clampScore(predicted + spread), ready_date: ready, on_track: onTrack, recommendation_code: code, recommendation: code, status: 'ok', current_estimate: current, slope_per_week: pts.length >= 2 ? Math.round(b * 10) / 10 : null };
  };

  // ------------------------------------------------------------------ drill từ lỗi
  const createDrill = (u: MockUserRecord, entries: MockErrorRecord[], planTaskId: string | null) => {
    const over = d.quotaExceeded(u, 'part_drill');
    if (over) return over;
    d.consumeQuota(u, 'part_drill');
    const started = Date.now();
    const ids = [...new Set(entries.map((e) => e.question_id))].filter((id) => !!d.questionById(id));
    if (!ids.length) return error(404, 'not_found', 'No open errors');
    const mode: AttemptMode = 'timed_drill';
    const rec: MockAttemptRecord = { id: uuid(), user_id: u.id, test_set_id: '', question_ids: ids, program: 'toeic', mode, status: 'in_progress', started_at: new Date(started).toISOString(), expires_at: new Date(started + ids.length * 45_000).toISOString(), submitted_at: null, answers: {}, section_elapsed_sec: {}, ui_state: {}, events: [], result: null, plan_task_id: planTaskId, idempotency_key: null };
    state.attempts[rec.id] = rec;
    persist();
    return json(201, d.toAttemptDto(rec));
  };

  const examLocked = (u: MockUserRecord) => {
    const id = d.openExamId(u.id);
    return id ? error(403, 'exam_mode_locked', 'Locked during an exam', { attempt_id: id }) : null;
  };

  const pageOf = <T>(all: T[], url: URL, def = 20) => {
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || def));
    const offset = Math.max(0, Number(url.searchParams.get('cursor')) || 0);
    const data = all.slice(offset, offset + limit);
    return { data, next_cursor: offset + limit < all.length ? String(offset + limit) : null };
  };

  const routes: R[] = [
    // ---------------------------------------------------------------- SRS
    route('GET', '/me/srs/due', ({ url }) => {
      const u = requireUser();
      if (u instanceof Response) return u;
      const now = Date.now();
      const listId = url.searchParams.get('list_id');
      const type = url.searchParams.get('card_type');
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 30));
      const locked = !!d.openExamId(u.id);
      const mine = cardsOf(u).filter((c) => (!listId || c.list_ids.includes(listId)) && (!type || c.card_type === type) && !(locked && c.card_type === 'error'));
      const learned = mine.filter((c) => c.state !== 'new');
      const dueNow = learned.filter((c) => Date.parse(c.due_at) <= now).sort((x, y) => Number(y.state !== 'review') - Number(x.state !== 'review') || x.due_at.localeCompare(y.due_at));
      const fresh = mine.filter((c) => c.state === 'new').sort((x, y) => x.created_at.localeCompare(y.created_at) || x.id.localeCompare(y.id));
      const limitNew = newLimitOf(u);
      const used = newUsed(u);
      const remaining = limitNew === null ? null : Math.max(0, limitNew - used);
      const take = dueNow.slice(0, limit);
      const newTake = fresh.slice(0, Math.max(0, Math.min(remaining ?? fresh.length, limit - take.length)));
      const future = learned.filter((c) => Date.parse(c.due_at) > now).map((c) => c.due_at).sort();
      return json(200, {
        data: [...take, ...newTake].map((c) => cardDto(c, now)),
        counts: { due: learned.filter((c) => Date.parse(c.due_at) <= endOfVnDay()).length, due_now: dueNow.length, new_total: fresh.length, new_limit: limitNew, new_used_today: used, new_remaining: remaining, new_in_session: newTake.length },
        next_due_at: future[0] ?? null,
        new_resets_at: d.resetAt('day'),
        server_time: nowIso(),
      });
    }),
    route('POST', '/me/srs/review', ({ body }) => {
      const u = requireUser();
      if (u instanceof Response) return u;
      const reviews = (body as { reviews?: Array<{ card_id: string; rating: number; review_mode?: string; reviewed_at?: string }> } | null)?.reviews ?? [];
      if (!Array.isArray(reviews) || !reviews.length || reviews.length > 100 || reviews.some((r) => ![1, 2, 3, 4].includes(r.rating))) return error(400, 'validation_failed', 'Invalid reviews');
      const mine = new Map(cardsOf(u).map((c) => [c.id, c]));
      if (reviews.some((r) => !mine.has(r.card_id))) return error(404, 'not_found', 'Card not found');
      // Hạn mức thẻ mới áp khi HỌC (lần ôn đầu của thẻ new) – cả lô bị từ chối nếu vượt
      const newOnes = new Set(reviews.filter((r) => mine.get(r.card_id)!.state === 'new' && !state.srsReviews[`${r.card_id}|${r.reviewed_at ?? ''}`]).map((r) => r.card_id));
      const limit = newLimitOf(u);
      if (limit !== null && newOnes.size && newUsed(u) + newOnes.size > limit) return d.quotaExceeded(u, 'srs_new_cards') ?? error(429, 'quota_exceeded', 'Quota exceeded', { quota: { feature: 'srs_new_cards', period: 'day', limit, used: newUsed(u), remaining: Math.max(0, limit - newUsed(u)), resets_at: d.resetAt('day'), reset_at: d.resetAt('day') }, feature: 'srs_new_cards', reset_at: d.resetAt('day') });
      const out: unknown[] = [];
      for (const r of reviews) {
        const c = mine.get(r.card_id)!;
        const at = r.reviewed_at && Date.parse(r.reviewed_at) <= Date.now() + 5 * MIN ? Date.parse(r.reviewed_at) : Date.now();
        const key = `${c.id}|${r.reviewed_at ?? new Date(at).toISOString()}`;
        if (state.srsReviews[key]) {
          out.push(cardDto(c, Date.now(), { duplicate: true, in_session: Date.parse(c.due_at) - Date.now() <= IN_SESSION_MS }));
          continue;
        }
        if (c.state === 'new') d.consumeQuota(u, 'srs_new_cards');
        const next = scheduleMock(c, r.rating as 1 | 2 | 3 | 4, at);
        Object.assign(c, { state: next.state, due_at: new Date(next.due).toISOString(), stability: next.stability, difficulty: 5, reps: c.reps + 1, lapses: next.lapses, last_review_at: new Date(at).toISOString() });
        state.srsReviews[key] = true;
        const { preview: _p, ...dto } = cardDto(c, at, { duplicate: false, in_session: next.due - at <= IN_SESSION_MS });
        out.push(dto);
      }
      persist();
      return json(200, out);
    }),
    route('GET', '/me/srs/cards', ({ url }) => {
      const u = requireUser();
      if (u instanceof Response) return u;
      const type = url.searchParams.get('card_type');
      const st = url.searchParams.get('state');
      const listId = url.searchParams.get('list_id');
      const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
      const all = cardsOf(u)
        .filter((c) => (!type || c.card_type === type) && (!st || c.state === st) && (!listId || c.list_ids.includes(listId)) && (!q || (typeof c.payload.headword === 'string' ? c.payload.headword : '').toLowerCase().includes(q)))
        .sort((x, y) => x.created_at.localeCompare(y.created_at) || x.id.localeCompare(y.id));
      const page = pageOf(all, url);
      return json(200, { data: page.data.map((c) => cardDto(c)), next_cursor: page.next_cursor });
    }),
    route('POST', '/me/srs/cards', ({ body }) => {
      const u = requireUser();
      if (u instanceof Response) return u;
      const b = (body ?? {}) as { card_type?: string; ref_id?: string; headword?: string; context?: string; source_type?: string };
      if (b.card_type === 'error') {
        const e = b.ref_id ? state.errorLog[b.ref_id] : undefined;
        if (!e || e.user_id !== u.id) return error(404, 'not_found', 'Error entry not found');
        const existed = Object.values(state.srs).some((c) => c.user_id === u.id && c.card_type === 'error' && c.ref_id === e.id);
        const c = errorCardFor(u, e);
        e.srs_card_id = c.id;
        persist();
        return json(existed ? 200 : 201, { ...cardDto(c), created: !existed });
      }
      if (b.card_type !== 'vocab') return error(400, 'validation_failed', 'Unsupported card_type');
      const hw = b.headword?.trim().toLowerCase();
      const entry = b.ref_id ? MOCK_DICTIONARY.find((e) => e.id === b.ref_id) : hw ? MOCK_DICTIONARY.find((e) => e.headword === hw || e.forms.includes(hw)) : undefined;
      if (b.ref_id && !entry) return error(404, 'not_found', 'Vocab item not found');
      if (!entry && !hw) return error(400, 'validation_failed', 'ref_id or headword is required');
      const ref = entry ? entry.id : `hw:${hw}`;
      const key = `${u.id}|${ref}`;
      const s6 = state.srsCards[key];
      if (s6) {
        migrateS6(u);
        return json(200, { ...cardDto(state.srs[s6.id]!), created: false });
      }
      // S10: không tính hạn mức khi THÊM thẻ (chỉ khi học lần đầu – ADR-0033)
      const card = { id: uuid(), user_id: u.id, ref_id: ref, headword: entry?.headword ?? hw ?? '', created_at: nowIso(), context: b.context ?? null };
      state.srsCards[key] = card;
      migrateS6(u);
      const rec = state.srs[card.id]!;
      rec.source_type = b.source_type ?? 'dictionary';
      if (b.context) rec.payload = { ...rec.payload, context: b.context };
      persist();
      return json(201, { ...cardDto(rec), created: true });
    }),

    // ---------------------------------------------------------------- bộ từ
    route('GET', '/vocab/lists', ({ locale }) => {
      const u = requireUser();
      if (u instanceof Response) return u;
      return json(200, MOCK_S10_LISTS.map((l) => listDto(u, l, locale)));
    }),
    route('GET', '/vocab/lists/{listId}/items', ({ params, url }) => {
      const u = requireUser();
      if (u instanceof Response) return u;
      const l = MOCK_S10_LISTS.find((x) => x.id === params.listId);
      if (!l) return error(404, 'not_found', 'vocab list not found');
      const mine = new Map(cardsOf(u).filter((c) => c.card_type === 'vocab').map((c) => [c.ref_id, c]));
      const items = l.words.map((id, i) => {
        const e = MOCK_DICTIONARY.find((x) => x.id === id)!;
        const c = mine.get(id);
        return { id: e.id, kind: 'word', headword: e.headword, reading: null, sino_vietnamese: null, pos: e.pos, ipa_uk: e.ipa_uk, ipa_us: e.ipa_us, audio_uk_url: null, audio_us_url: null, meanings: e.meanings, examples: e.examples.map((x) => ({ text: x.en, translation: { vi: x.vi } })), collocations: e.collocations, level: e.level, topics: e.topics, sort_order: i + 1, srs: c ? (({ preview: _p, ...rest }) => rest)(cardDto(c)) : null };
      });
      return json(200, pageOf(items, url, 50));
    }),
    route('POST', '/vocab/lists/{listId}/enroll', ({ params }) => {
      const u = requireUser();
      if (u instanceof Response) return u;
      const l = MOCK_S10_LISTS.find((x) => x.id === params.listId);
      if (!l) return error(404, 'not_found', 'vocab list not found');
      if (!l.is_free && !d.isPro(u)) return error(403, 'forbidden', 'Pro list', { upgrade: true });
      const mine = new Map(cardsOf(u).filter((c) => c.card_type === 'vocab').map((c) => [c.ref_id, c]));
      let added = 0;
      let existing = 0;
      for (const [i, id] of l.words.entries()) {
        const c = mine.get(id);
        if (c) {
          existing++;
          if (!c.list_ids.includes(l.id)) c.list_ids.push(l.id);
          continue;
        }
        const e = MOCK_DICTIONARY.find((x) => x.id === id)!;
        const cardId = uuid();
        // Thứ tự học theo bộ: created_at tăng dần theo sort_order
        const created = new Date(Date.now() + i).toISOString();
        state.srsCards[`${u.id}|${id}`] = { id: cardId, user_id: u.id, ref_id: id, headword: e.headword, created_at: created, context: null };
        state.srs[cardId] = { id: cardId, user_id: u.id, card_type: 'vocab', ref_id: id, state: 'new', due_at: created, stability: null, difficulty: null, reps: 0, lapses: 0, last_review_at: null, payload: vocabPayload(e), source_type: 'vocab_list', created_at: created, list_ids: [l.id] };
        added++;
      }
      persist();
      return json(200, { list_id: l.id, total: l.words.length, added, existing, new_per_day: newLimitOf(u) });
    }),

    // ---------------------------------------------------------------- sổ lỗi
    route('GET', '/me/errors', ({ url }) => {
      const u = requireUser();
      if (u instanceof Response) return u;
      const locked = examLocked(u);
      if (locked) return locked;
      const list = filterErrors(u, url);
      const dist: Record<string, number> = {};
      for (const e of filterErrors(u, url, 'kind')) dist[e.reason_override ?? e.kind_auto] = (dist[e.reason_override ?? e.kind_auto] ?? 0) + 1;
      const bySection: Record<string, number> = {};
      for (const e of filterErrors(u, url, 'part')) bySection[e.section_code] = (bySection[e.section_code] ?? 0) + 1;
      const all = Object.values(state.errorLog).filter((e) => e.user_id === u.id);
      const page = pageOf(list, url);
      return json(200, { distribution: dist, by_section: bySection, totals: { open: all.filter((e) => !e.resolved).length, resolved: all.filter((e) => e.resolved).length }, paraphrase_map: [], recurring_writing_speaking: [], data: page.data.map(errorDto), next_cursor: page.next_cursor });
    }),
    route('PATCH', '/me/errors/{entryId}', ({ params, body }) => {
      const u = requireUser();
      if (u instanceof Response) return u;
      const locked = examLocked(u);
      if (locked) return locked;
      const e = state.errorLog[params.entryId!];
      if (!e || e.user_id !== u.id) return error(404, 'not_found', 'Error entry not found');
      const b = (body ?? {}) as { reason_override?: string | null; resolved?: boolean; note?: string | null; create_card?: boolean };
      if (!Object.values(b).some((v) => v !== undefined)) return error(400, 'validation_failed', 'empty patch');
      if (b.reason_override !== undefined) e.reason_override = b.reason_override;
      if (b.note !== undefined) e.note = b.note && b.note.trim() ? b.note.trim().slice(0, 1000) : null;
      if (b.resolved !== undefined) {
        e.resolved = b.resolved;
        e.resolved_at = b.resolved ? nowIso() : null;
      }
      if (b.create_card) e.srs_card_id = errorCardFor(u, e).id;
      persist();
      return json(200, errorDto(e));
    }),
    route('POST', '/me/errors/drill', ({ body }) => {
      const u = requireUser();
      if (u instanceof Response) return u;
      const locked = examLocked(u);
      if (locked) return locked;
      const b = (body ?? {}) as { entry_ids?: string[]; kind?: string; part?: string; limit?: number; plan_task_id?: string };
      const open = Object.values(state.errorLog).filter((e) => e.user_id === u.id && !e.resolved);
      let picked: MockErrorRecord[];
      if (b.entry_ids?.length) {
        if (b.entry_ids.length > 10) return error(400, 'validation_failed', 'entry_ids ≤ 10');
        picked = b.entry_ids.map((id) => open.find((e) => e.id === id)).filter((e): e is MockErrorRecord => !!e);
        if (picked.length !== b.entry_ids.length) return error(404, 'not_found', 'Some entries not found or resolved');
      } else {
        picked = open
          .filter((e) => (!b.kind || (e.reason_override ?? e.kind_auto) === b.kind) && (!b.part || e.section_code === b.part))
          .sort((x, y) => x.last_seen_at.localeCompare(y.last_seen_at))
          .slice(0, Math.min(10, b.limit ?? 10));
      }
      if (!picked.length) return error(404, 'not_found', 'No open errors');
      return createDrill(u, picked, b.plan_task_id ?? null);
    }),

    // ---------------------------------------------------------------- dự báo
    route('GET', '/me/forecast', ({ url }) => {
      const u = requireUser();
      if (u instanceof Response) return u;
      return json(200, forecastOf(u, url.searchParams.get('program') ?? 'toeic'));
    }),

    // ---------------------------------------------------------------- phễu & đăng ký chờ
    route('POST', '/analytics/events', ({ body }) => {
      const b = (body ?? {}) as { event?: string; anonymous_id?: string; consent?: boolean; path?: string };
      if (!b.event || !['landing_view', 'signup_start', 'checkout_start'].includes(b.event) || !/^[A-Za-z0-9_-]{8,64}$/.test(b.anonymous_id ?? '')) return error(400, 'validation_failed', 'Invalid event');
      state.analyticsEvents.push({ event: b.event, consent: b.consent === true, anonymous_id: b.anonymous_id!, path: b.path ?? null, at: nowIso() });
      if (state.analyticsEvents.length > 200) state.analyticsEvents.shift();
      persist();
      return json(202, b.consent === true ? { accepted: true, reason: 'ok' } : { accepted: false, reason: 'no_consent' });
    }),
    route('POST', '/waitlist', ({ body }) => {
      const b = (body ?? {}) as { email?: string; program?: string; locale?: string; consent_marketing?: boolean };
      if (!b.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email) || !['ielts', 'jlpt', 'hsk'].includes(b.program ?? '')) return error(400, 'validation_failed', 'Invalid waitlist signup');
      state.waitlist.push({ program: b.program!, locale: b.locale ?? 'vi', at: nowIso() });
      persist();
      return json(202, { status: 'accepted' });
    }),
  ];

  return { routes, onAttemptGraded, statsExtras };
}
