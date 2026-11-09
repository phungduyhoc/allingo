import { attemptEventSchema, attemptUiStateSchema, timedDrillBudgetSeconds, type Attempt, type AttemptMode, type AttemptResult, type AttemptReview, type AttemptSummary, type TranscriptHighlight } from '@allingo/schemas/api/attempt';
import { aiFeedbackInputSchema, type AttemptAiDiagnosis, type Entitlements, type Explanation, type Stats, type User } from '@allingo/schemas/api/core';
import { ATTEMPT_GRACE_SECONDS, DEFAULT_QUOTAS, XP_RULES } from '@allingo/schemas/product';
import { answerInputSchema, isAnswered } from '@allingo/schemas/question/answer';
import { correctAnswerOf, grade } from '@allingo/schemas/question/grade';
import { isSpokenTextSection, redactSpokenText, toPublicContent } from '@allingo/schemas/question/public';
import { SCALE_INFO, TOEIC_PART_SKILL, diagnoseAttempt, scoreByProgram, toeicLr, toeicLrEstimate } from '@allingo/scoring';
import { env } from '@/env';
import { FLAG_DEFAULTS, PUBLIC_FLAG_KEYS } from '@/lib/flags';
import { MOCK_PROGRAMS, MOCK_SUBSKILL_OF_TAG, MOCK_TEST_SETS, type MockQuestion, type MockTestSet } from './fixtures';
import { MOCK_IELTS_TEST_SETS } from './ielts-fixtures';
import { evidenceSegmentsOf, mockExamFormat, mockNumbering, mockSectionClock, playedAssets } from './ielts-format';
import { marksOf } from '@allingo/schemas/question/marks';
import { isProgramCode, programDef, skillOfSection } from '@allingo/schemas/program/registry';
import { loadState, saveState, type MockAttemptRecord, type MockState, type MockUserRecord } from './state';
import { latestNoteFor, learningToolRoutes } from './learning-tools';
import { billingRoutes } from './billing';
import { growthRoutes, referralHooks } from './growth';
import { learningPlanMock } from './learning-plan';
import { s10Mock } from './s10';
import { s12Mock } from './s12';
import { contentToolsMock } from './content-tools';
import { MOCK_DIAGNOSTIC_QUESTIONS, MOCK_DIAGNOSTIC_SET } from './diagnostic-fixtures';

/**
 * fetch giả lập cho dev/e2e khi NEXT_PUBLIC_API_MOCK=1. Bám hợp đồng docs/spec/allingo-openapi.yaml + Zod
 * trong packages/schemas (envelope lỗi, cookie-mode, SSE cho /ai/explain, submit idempotent, quota Free).
 * Không dùng ở production; không chứa logic nghiệp vụ "thật".
 */

const LATENCY_MS = 120;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();
const uuid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

/** S12: mọi phản hồi có `X-Trace-Id` như API (góp ý in-app tự gắn trace gần nhất) */
const mockTraceId = () => `mock${Math.random().toString(16).slice(2, 14).padEnd(12, '0')}`;
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'X-Trace-Id': mockTraceId(), ...headers } });
const empty = (status: number) => new Response(null, { status });
const error = (status: number, code: string, message: string, details?: Record<string, unknown>) =>
  json(status, { error: { code, message, details, trace_id: `mock-${uuid().slice(0, 8)}` } });

type Handler = (ctx: { url: URL; params: Record<string, string>; body: unknown; method: string; locale: string; headers: Headers }) => Promise<Response> | Response;
interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

function route(method: string, path: string, handler: Handler): Route {
  const keys: string[] = [];
  const pattern = new RegExp(
    '^' +
      path.replace(/\{(\w+)\}/g, (_, k: string) => {
        keys.push(k);
        return '([^/]+)';
      }) +
      '$',
  );
  return { method, pattern, keys, handler };
}

function publicUser(u: MockUserRecord): User {
  const { password: _p, guest_token: _g, plan: _plan, plan_kind: _pk, referral_code: _rc, attribution: _attr, ...rest } = u;
  return rest;
}

/** Kỳ hạn mức theo giờ Việt Nam (như QuotaService của API: reset 00:00 Asia/Ho_Chi_Minh) */
const VN_OFFSET_MS = 7 * 3_600_000;
const vnNow = () => new Date(Date.now() + VN_OFFSET_MS); // các trường UTC = giờ treo tường VN
function periodKey(period: string): string {
  const iso = vnNow().toISOString();
  return period === 'month' ? iso.slice(0, 7) : period === 'lifetime' ? 'all' : iso.slice(0, 10);
}
function resetAtOf(period: string): string {
  const v = vnNow();
  if (period === 'lifetime') return new Date(Date.UTC(9999, 0, 1)).toISOString();
  const next = period === 'month' ? Date.UTC(v.getUTCFullYear(), v.getUTCMonth() + 1, 1) : Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate() + 1);
  return new Date(next - VN_OFFSET_MS).toISOString();
}

type MockPlan = 'free' | 'monthly';
const planOf = (u: MockUserRecord): MockPlan => u.plan ?? 'free';
const isPro = (u: MockUserRecord) => planOf(u) !== 'free';
/** Hạn mức theo gói (seed DEFAULT_QUOTAS – như billing.quotas); không có dòng → không giới hạn */
function quotaFor(u: MockUserRecord, feature: string): { feature: string; period: string; limit: number } | null {
  return DEFAULT_QUOTAS.find((x) => x.plan_kind === planOf(u) && x.feature === feature) ?? null;
}
/** Quyền theo gói (như GET /me/entitlements của API seed) */
const FREE_FEATURES = ['ai_tutor', 'full_test', 'mini_test', 'ai_explain', 'part_drill', 'study_plan', 'dictionary_ai', 'srs_new_cards'];
const PRO_FEATURES = ['ai_diagnose', 'ai_explain', 'ai_tutor', 'dictionary_ai', 'full_test', 'grade_speaking', 'grade_writing', 'mini_test', 'part_drill', 'shadowing', 'srs_new_cards', 'streak_freeze', 'study_plan'];
/** Credit cho chẩn đoán AI (như ai.model_routes.credits_cost của diagnose_rl) */
const DIAGNOSE_CREDITS = 10;
/** prompt_version_id giả lập (khoá cache giải thích/chẩn đoán gồm phiên bản prompt) */
const PROMPT_VERSION = { explain_mcq: '00000000-0000-4000-8000-00000000e301', diagnose_rl: '00000000-0000-4000-8000-00000000d301' } as const;
/** Tài khoản Pro demo như seed API (`pnpm db:seed --set demo`) */
const PRO_DEMO = { email: 'learner_pro@allingo.dev', password: 'Allingo@2026', display_name: 'Minh (Pro)' };
/** Admin demo như seed API – vào /admin/billing (S7/S8) */
const ADMIN_DEMO = { email: 'admin@allingo.dev', password: 'Allingo@2026', display_name: 'Admin Allingo' };

/** S12: bản rút gọn `checkPasswordPolicy` của API (apps/api/src/modules/iam/password/password-policy.ts) cho đăng ký ở mock */
const MOCK_PASSWORD_MIN = 12;
const MOCK_COMMON_BASES = new Set(['password', 'passw0rd', 'qwerty', 'qwertyuiop', 'iloveyou', 'admin', 'welcome', 'letmein', 'allingo', 'matkhau', 'abc123', '123456', '12345678', '123456789', '1234567890', '123456789012']);
function mockPasswordIssue(password: string, context: Array<string | undefined>): 'password_too_short' | 'password_breached' | 'password_weak' | null {
  if ([...password].length < MOCK_PASSWORD_MIN) return 'password_too_short';
  const lower = password.trim().toLowerCase();
  const base = /^(.*?)([0-9!@#$%^&*._\-+=?~]{0,6})$/.exec(lower)?.[1] ?? lower;
  if (MOCK_COMMON_BASES.has(lower) || MOCK_COMMON_BASES.has(base)) return 'password_breached';
  if (new Set(lower).size <= 2) return 'password_weak';
  for (const c of context) {
    const token = (c ?? '').toLowerCase().split('@')[0]!.replace(/\s+/g, '');
    if (token.length >= 4 && lower.includes(token) && lower.length - token.length < 6) return 'password_weak';
  }
  return null;
}

/** Cờ mặc định của "máy chủ" giả = FLAG_FALLBACKS của API (S12: `ff.ai.diagnose` bật mặc định cả hai phía) */
const MOCK_FLAG_DEFAULTS: Record<string, boolean> = { ...FLAG_DEFAULTS };
/** Route có `@KillSwitch(flag)` ở API (S11) */
const KILL_SWITCHES: Array<[string, RegExp, string]> = [
  ['POST', /^\/ai\/explain$/, 'ff.ai.explain'],
  ['POST', /^\/ai\/threads$/, 'ff.ai.tutor'],
  ['POST', /^\/attempts\/[^/]+\/diagnosis$/, 'ff.ai.diagnose'],
  ['POST', /^\/ai\/threads\/[^/]+\/messages$/, 'ff.ai.tutor'],
];
const killSwitchFor = (method: string, path: string) => KILL_SWITCHES.find(([m, re]) => m === method && re.test(path))?.[2] ?? null;

/**
 * Kịch bản lỗi AI cho dev/E2E: đặt `window.__ALLINGO_MOCK_AI_FAIL__ = 'ai_failed' | 'ai_timeout'` → lượt AI kế tiếp phát
 * `start` → `delta` → `error` → `done` (hoàn quota) rồi tự xoá cờ.
 */
function takeMockAiFailure(): 'ai_failed' | 'ai_timeout' | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { __ALLINGO_MOCK_AI_FAIL__?: unknown };
  const v = w.__ALLINGO_MOCK_AI_FAIL__;
  if (v !== 'ai_failed' && v !== 'ai_timeout') return null;
  delete w.__ALLINGO_MOCK_AI_FAIL__;
  return v;
}

/** Cắt JSON đầu ra thành các mảnh `delta` như provider stream structured output */
function jsonDeltas(value: unknown, size = 28, delayMs = 45): { event: string; data: unknown; delayMs?: number }[] {
  const text = JSON.stringify(value);
  const out: { event: string; data: unknown; delayMs?: number }[] = [];
  for (let i = 0; i < text.length; i += size) out.push({ event: 'delta', data: { text: text.slice(i, i + size) }, delayMs });
  return out;
}

/** URL "ký" giả lập (TTL 10′ như driver fs của API): `sig=init` cho URL trong attempt/review, `sig=r<n>` cho URL gia hạn */
const MEDIA_TTL_MS = 10 * 60_000;
let refreshCounter = 0;
function signUrl(url: string, sig: string): { url: string; expires_at: string } {
  const exp = Date.now() + MEDIA_TTL_MS;
  return { url: `${url}${url.includes('?') ? '&' : '?'}exp=${Math.floor(exp / 1000)}&sig=${sig}`, expires_at: new Date(exp).toISOString() };
}

export function createMockFetch(): typeof fetch {
  const state: MockState = loadState();
  const persist = () => saveState(state);
  // Pro demo (đăng nhập learner_pro@allingo.dev / Allingo@2026) để thử chẩn đoán AI ở chế độ mock
  if (!Object.values(state.users).some((u) => u.email === PRO_DEMO.email)) {
    const id = uuid();
    state.users[id] = { id, email: PRO_DEMO.email, password: PRO_DEMO.password, display_name: PRO_DEMO.display_name, phone: null, avatar_url: null, ui_locale: 'vi', explain_locale: 'vi', timezone: 'Asia/Ho_Chi_Minh', roles: ['learner'], active_program: 'toeic', created_at: nowIso(), is_guest: false, plan: 'monthly' };
    state.credits[id] = 5000;
    persist();
  }
  if (!Object.values(state.users).some((u) => u.email === ADMIN_DEMO.email)) {
    const id = uuid();
    state.users[id] = { id, email: ADMIN_DEMO.email, password: ADMIN_DEMO.password, display_name: ADMIN_DEMO.display_name, phone: null, avatar_url: null, ui_locale: 'vi', explain_locale: 'vi', timezone: 'Asia/Ho_Chi_Minh', roles: ['learner', 'admin', 'editor'], active_program: 'toeic', created_at: nowIso(), is_guest: false, plan: 'free' };
    persist();
  }
  const referral = referralHooks(state, uuid, nowIso);

  // C2: đề mẫu IELTS (chương trình khác TOEIC) – không vào ngân hàng luyện tập TOEIC
  const findTestSet = (id: string): MockTestSet | undefined => MOCK_TEST_SETS.find((t) => t.id === id) ?? MOCK_IELTS_TEST_SETS.find((t) => t.id === id) ?? (id === MOCK_DIAGNOSTIC_SET.id ? MOCK_DIAGNOSTIC_SET : undefined);
  /** Câu luyện tập (đề mock) – S9: ngân hàng chẩn đoán tách riêng, chỉ dùng để tra câu theo id/phiên bản */
  const bankQuestions = (): MockQuestion[] => MOCK_TEST_SETS.flatMap((t) => t.questions);
  const allQuestions = (): MockQuestion[] => [...bankQuestions(), ...MOCK_IELTS_TEST_SETS.flatMap((t) => t.questions), ...MOCK_DIAGNOSTIC_QUESTIONS];
  const questionsOf = (a: MockAttemptRecord): MockQuestion[] => {
    if (!a.question_ids) return findTestSet(a.test_set_id)?.questions ?? [];
    // Lượt luyện: câu từ nhiều đề → đánh số lại 1..n như snapshot question_order của API
    const byId = new Map(allQuestions().map((q) => [q.question_id, q]));
    return a.question_ids.flatMap((id, i) => {
      const q = byId.get(id);
      return q ? [{ ...q, order_no: i + 1 }] : [];
    });
  };
  const FEEDBACK_MODES: ReadonlySet<string> = new Set(['practice', 'drill']);
  const subskillsOf = (q: MockQuestion): string[] => [...new Set((q.content.tags ?? []).map((tag) => MOCK_SUBSKILL_OF_TAG[tag]).filter((x): x is string => !!x))];

  const currentUser = (): MockUserRecord | null => (state.sessionUserId ? (state.users[state.sessionUserId] ?? null) : null);
  const requireUser = (): MockUserRecord | Response => currentUser() ?? error(401, 'unauthorized', 'Session expired');

  const usageOf = (userId: string, feature: string, period = 'day'): number => state.usage[userId]?.[feature]?.[periodKey(period)] ?? 0;
  const bumpUsage = (userId: string, feature: string, period = 'day', delta = 1) => {
    const u = (state.usage[userId] ??= {});
    const f = (u[feature] ??= {});
    const k = periodKey(period);
    f[k] = Math.max(0, (f[k] ?? 0) + delta);
  };
  /** Đã hết hạn mức → Response 429 đúng dạng API (details.quota = QuotaExceededDetails); còn → null */
  const quotaExceeded = (u: MockUserRecord, feature: string): Response | null => {
    const q = quotaFor(u, feature);
    if (!q) return null;
    const used = usageOf(u.id, feature, q.period);
    if (used < q.limit) return null;
    const resets = resetAtOf(q.period);
    return error(429, 'quota_exceeded', 'Quota exceeded', { quota: { feature, period: q.period, limit: q.limit, used, remaining: 0, resets_at: resets, reset_at: resets }, feature, reset_at: resets, upgrade: true });
  };
  const consumeQuota = (u: MockUserRecord, feature: string) => {
    const q = quotaFor(u, feature);
    if (q) bumpUsage(u.id, feature, q.period);
  };
  const refundQuota = (u: MockUserRecord, feature: string) => {
    const q = quotaFor(u, feature);
    if (q) bumpUsage(u.id, feature, q.period, -1);
  };
  const recordTask = (userId: string, task: string): string => {
    const id = uuid();
    state.aiTasks[id] = { user_id: userId, task };
    return id;
  };
  const examInProgress = (userId: string, exceptId?: string) => Object.values(state.attempts).some((a) => a.user_id === userId && a.status === 'in_progress' && a.mode === 'exam' && a.id !== exceptId);

  const makeUser = (partial: Partial<MockUserRecord> & { is_guest: boolean }): MockUserRecord => ({
    id: uuid(),
    email: null,
    phone: null,
    display_name: partial.is_guest ? 'Khách' : 'Learner',
    avatar_url: null,
    ui_locale: 'vi',
    explain_locale: 'vi',
    timezone: 'Asia/Ho_Chi_Minh',
    roles: ['learner'],
    active_program: 'toeic',
    created_at: nowIso(),
    ...partial,
  });

  /**
   * Câu công khai như API: URL media "ký" 10′; đang làm bài (`attempt`) → Part 1/2 xoá chữ đề/lựa chọn, passage audio_script
   * không có body (transcript). Review (`review`) trả đủ chữ + body.
   */
  const publicQuestion = (q: MockQuestion, view: 'attempt' | 'review', num?: { number_start: number; mark_count: number }): Attempt['questions'][number] => {
    const pub = toPublicContent(q.content);
    const content = view === 'attempt' && isSpokenTextSection('toeic', q.section_code) && 'media' in pub && pub.media?.audio_asset_id ? redactSpokenText(pub) : pub;
    const passage = q.passage
      ? (() => {
          const { segments: _s, media_asset_id, ...p } = q.passage;
          const signed = p.media_url ? signUrl(p.media_url, 'init') : null;
          return { ...p, body: view === 'attempt' && p.kind === 'audio_script' ? null : p.body, media_url: signed?.url ?? null, media_asset_id: media_asset_id ?? null, media_expires_at: signed?.expires_at ?? null };
        })()
      : null;
    return {
      question_id: q.question_id,
      question_version_id: q.question_version_id,
      question_type: q.content.type,
      section_code: q.section_code,
      group_key: q.group_key,
      order_no: q.order_no,
      // C3/S167: đánh số liên tục theo mục (như API)
      ...(num ? { number_start: num.number_start, mark_count: num.mark_count } : {}),
      content,
      media: q.media.map(({ transcript: _t, ...m }) => ({ ...m, ...signUrl(m.url, 'init') })),
      passage,
    };
  };
  /** TranscriptHighlight như API: passage audio_script (Part 3/4) hoặc transcript audio câu (Part 1/2), kèm evidence của tác giả */
  const transcriptOf = (q: MockQuestion): TranscriptHighlight | null => {
    const evidence = q.content.evidence ?? null;
    if (q.passage?.kind === 'audio_script' && q.passage.body) return { text: q.passage.body, ...(q.passage.segments ? { segments: q.passage.segments, evidence_segments: evidenceSegmentsOf(q.passage.segments, evidence) } : {}), evidence, source: 'passage', asset_id: q.passage.media_asset_id ?? null };
    const audio = q.media.find((m) => m.kind === 'audio');
    if (audio?.transcript) return { text: audio.transcript.text, ...(audio.transcript.segments ? { segments: audio.transcript.segments } : {}), evidence, source: 'media', asset_id: audio.id };
    return evidence ? { text: evidence, evidence, source: 'evidence', asset_id: audio?.id ?? null } : null;
  };

  const toAttemptDto = (a: MockAttemptRecord): Attempt => {
    const ts = findTestSet(a.test_set_id);
    const qs = questionsOf(a);
    const nums = mockNumbering(a.program, qs);
    const clock = mockSectionClock(a, ts, qs);
    const examFormat = mockExamFormat(a, ts, qs);
    // Như API: part đã nghe xong ở Exam Mode → passage.media_url = null
    const played = a.status === 'in_progress' ? playedAssets(examFormat) : new Set<string>();
    return {
      id: a.id,
      program: a.program as Attempt['program'],
      mode: a.mode,
      status: a.status,
      test_set: ts && !a.question_ids ? { id: ts.id, code: ts.code, title: ts.title, kind: ts.kind, question_count: ts.question_count, duration_sec: ts.duration_sec } : null,
      sections: [...new Set(qs.map((q) => q.section_code))].map((code) => ({
        section_code: code,
        duration_sec: FEEDBACK_MODES.has(a.mode) || a.question_ids ? null : (ts?.sections.find((s) => s.code === code)?.duration_sec ?? null),
        elapsed_sec: a.section_elapsed_sec[code] ?? 0,
        locked: clock.get(code)?.locked ?? false,
        ...(clock.get(code)?.skill ? { skill: clock.get(code)!.skill! } : {}),
        ends_at: clock.get(code)?.ends_at ?? null,
      })),
      questions: qs.map((q) => {
        const pub = publicQuestion(q, 'attempt', nums.get(q.question_id));
        return pub.passage?.media_asset_id && played.has(pub.passage.media_asset_id) ? { ...pub, passage: { ...pub.passage, media_url: null, media_expires_at: null } } : pub;
      }),
      exam_format: examFormat,
      draft_answers: Object.entries(a.answers).map(([question_id, r]) => ({ question_id, answer: r.answer, time_spent_ms: r.time_spent_ms, flagged: r.flagged })),
      started_at: a.started_at,
      expires_at: a.expires_at,
      server_time: nowIso(),
      ui_state: a.ui_state,
      audio_plays: a.audio_plays ?? {},
      // Practice/drill: đáp án + đúng/sai + giải thích tác giả cho câu ĐÃ trả lời (exam/timed không bao giờ có)
      ...(FEEDBACK_MODES.has(a.mode)
        ? {
            feedback: Object.fromEntries(
              qs.flatMap((q) => {
                const rec = a.answers[q.question_id];
                if (!rec || !isAnswered(rec.answer)) return [];
                const g = grade(q.content, rec.answer);
                // Transcript (v1.1): câu đơn ngay khi trả lời; nhóm Part 3/4 chỉ khi mọi câu trong nhóm đã trả lời (như API)
                const groupDone = !q.group_key || qs.filter((x) => x.group_key === q.group_key).every((x) => a.answers[x.question_id] && isAnswered(a.answers[x.question_id]!.answer));
                return [[q.question_id, { is_correct: g.is_correct, correct_answer: correctAnswerOf(q.content), explanation: q.content.explanation ? { ...q.content.explanation } : null, transcript: groupDone ? transcriptOf(q) : null, details: g.details ?? null }]];
              }),
            ),
          }
        : {}),
    };
  };

  /** C1: chương trình khác TOEIC (IELTS band – @allingo/scoring scoreByProgram, như AttemptsService.scale) */
  const gradeOtherProgram = (a: MockAttemptRecord, qs: MockQuestion[], bySection: AttemptResult['by_section'], byType: AttemptResult['by_question_type'], bySubskill: AttemptResult['by_subskill'], correct: number, unanswered: number): AttemptResult => {
    const def = programDef(a.program);
    const skillOf = (code: string) => skillOfSection(a.program, code);
    // C3: hình thức Reading IELTS theo catalog.test_sets.level (Academic/GT – bảng band riêng)
    const level = findTestSet(a.test_set_id)?.level;
    const r = scoreByProgram({ program: a.program, kind: def?.scale.kind ?? 'points', bySection: Object.fromEntries(Object.entries(bySection).map(([k, v]) => [k, { marks: v.marks ?? v.correct, max_marks: v.max_marks ?? v.total }])), skillOf, module: level === 'general_training' ? 'general_training' : 'academic' });
    for (const [code, s] of Object.entries(bySection)) s.score = r.sections[code] ?? null;
    const bySkill: NonNullable<AttemptResult['by_skill']> = {};
    for (const [code, s] of Object.entries(bySection)) {
      const skill = skillOf(code);
      if (!skill) continue;
      const b = (bySkill[skill] ??= { correct: 0, total: 0, marks: 0, max_marks: 0, scaled: r.skills[skill]?.scaled ?? null, range: null, avg_time_ms: null, community_avg_time_ms: 15_000, by_subskill: {}, by_topic: {} });
      b.correct += s.correct;
      b.total += s.total;
      b.marks = (b.marks ?? 0) + (s.marks ?? 0);
      b.max_marks = (b.max_marks ?? 0) + (s.max_marks ?? 0);
    }
    const xp = XP_RULES.attempt_submitted + correct * XP_RULES.question_correct;
    state.xp[a.user_id] = (state.xp[a.user_id] ?? 0) + xp;
    return {
      attempt_id: a.id,
      raw_score: Object.values(bySection).reduce((n, s) => n + (s.marks ?? s.correct), 0),
      scaled_score: r.value,
      scale: { ...r.scale, total_questions: qs.length, unanswered },
      by_section: bySection,
      by_question_type: byType,
      by_subskill: bySubskill,
      compared_to_previous: null,
      diagnosis: null,
      xp_earned: xp,
      scaled: null,
      by_skill: bySkill,
    };
  };

  const gradeAttempt = (a: MockAttemptRecord): AttemptResult => {
    const qs = questionsOf(a);
    const bySection: AttemptResult['by_section'] = {};
    const byType: AttemptResult['by_question_type'] = {};
    const bySubskill: AttemptResult['by_subskill'] = {};
    let correct = 0;
    let unanswered = 0;
    // C1: điểm thô theo registry chương trình (IELTS: theo mục đánh số) như API
    const marking = programDef(a.program)?.marking ?? 'per_question';
    for (const q of qs) {
      const rec = a.answers[q.question_id];
      const g = grade(q.content, rec?.answer ?? null);
      if (!rec || !isAnswered(rec.answer)) unanswered++;
      const ok = g.is_correct === true;
      if (ok) correct++;
      const mk = marksOf(q.content, g, marking);
      const sec = (bySection[q.section_code] ??= { correct: 0, total: 0, avg_time_ms: null, score: null, marks: 0, max_marks: 0 });
      sec.total++;
      if (ok) sec.correct++;
      sec.marks = (sec.marks ?? 0) + mk.earned;
      sec.max_marks = (sec.max_marks ?? 0) + mk.max;
      const t = (byType[q.content.type] ??= { correct: 0, total: 0, marks: 0, max_marks: 0 });
      t.total++;
      if (ok) t.correct++;
      t.marks = (t.marks ?? 0) + mk.earned;
      t.max_marks = (t.max_marks ?? 0) + mk.max;
      for (const tag of q.content.tags ?? []) {
        const s = (bySubskill[tag] ??= { correct: 0, total: 0 });
        s.total++;
        if (ok) s.correct++;
      }
    }
    const listening = { correct: 0, total: 0 };
    const reading = { correct: 0, total: 0 };
    const program = isProgramCode(a.program) ? a.program : 'toeic';
    const skillOf = (code: string) => skillOfSection(program, code) ?? TOEIC_PART_SKILL[code] ?? null;
    if (program !== 'toeic') return gradeOtherProgram(a, qs, bySection, byType, bySubskill, correct, unanswered);
    for (const [code, s] of Object.entries(bySection)) {
      const skill = skillOf(code);
      if (skill === 'listening') {
        listening.correct += s.correct;
        listening.total += s.total;
      } else if (skill === 'reading') {
        reading.correct += s.correct;
        reading.total += s.total;
      }
    }
    const lr = toeicLr({ listening: listening.total ? listening : undefined, reading: reading.total ? reading : undefined });
    const est = toeicLrEstimate({ listening: listening.total ? listening : undefined, reading: reading.total ? reading : undefined });
    // Theo kỹ năng (v1.1): số câu, điểm quy đổi + khoảng, thời gian TB so cộng đồng (mock: cộng đồng 15 s/câu)
    const bySkill: NonNullable<AttemptResult['by_skill']> = {};
    for (const [skill, cnt] of [['listening', listening], ['reading', reading]] as const) {
      if (!cnt.total) continue;
      const times = qs.filter((q) => TOEIC_PART_SKILL[q.section_code] === skill).map((q) => a.answers[q.question_id]?.time_spent_ms).filter((x): x is number => typeof x === 'number');
      bySkill[skill] = {
        correct: cnt.correct,
        total: cnt.total,
        scaled: est[skill],
        range: est.ranges[skill],
        avg_time_ms: times.length ? Math.round(times.reduce((x, y) => x + y, 0) / times.length) : null,
        community_avg_time_ms: 15_000,
        by_subskill: {},
        by_topic: {},
      };
    }
    const scaled = lr.total ?? lr.listening ?? lr.reading;
    // Chẩn đoán theo quy tắc như API (packages/scoring.diagnoseAttempt); hết giờ mới nộp → coi là tự nộp
    const autoSubmitted = !!a.expires_at && Date.now() >= Date.parse(a.expires_at);
    const diagnosis = diagnoseAttempt(
      qs.map((q) => {
        const rec = a.answers[q.question_id];
        return { question_id: q.question_id, section_code: q.section_code, subskill_codes: subskillsOf(q), topic_code: null, answered: !!rec && isAnswered(rec.answer), is_correct: grade(q.content, rec?.answer ?? null).is_correct, time_ms: rec?.time_spent_ms ?? null };
      }),
      { autoSubmitted },
    );
    const previous = Object.values(state.attempts)
      .filter((x) => x.user_id === a.user_id && x.id !== a.id && x.result && x.test_set_id === a.test_set_id)
      .sort((x, y) => (y.submitted_at ?? '').localeCompare(x.submitted_at ?? ''))[0];
    const xp = XP_RULES.attempt_submitted + correct * XP_RULES.question_correct;
    state.xp[a.user_id] = (state.xp[a.user_id] ?? 0) + xp;
    return {
      attempt_id: a.id,
      raw_score: correct,
      scaled_score: scaled,
      // Cùng dạng scale của API: listening/reading/total + partial (một kỹ năng → thang 5–495)
      scale: { ...SCALE_INFO.toeic, listening: lr.listening, reading: lr.reading, total: lr.total, ci: lr.ci, partial: lr.total === null, total_questions: qs.length, unanswered },
      by_section: bySection,
      by_question_type: byType,
      by_subskill: bySubskill,
      compared_to_previous:
        previous && previous.result
          ? { scaled_delta: scaled !== null && previous.result.scaled_score !== null ? scaled - previous.result.scaled_score : null, previous_attempt_id: previous.id }
          : null,
      diagnosis: diagnosis as unknown as Record<string, unknown>,
      xp_earned: xp,
      scaled: { listening: est.listening, reading: est.reading, total: est.total, range: est.range, ranges: est.ranges, estimated: true },
      by_skill: bySkill,
    };
  };

  const buildExplanation = (q: MockQuestion, chosen: string | undefined, locale: string, aiTaskId: string, cached: boolean): Explanation => {
    const vi = locale === 'vi';
    const c = q.content;
    const rawCorrect = correctAnswerOf(c);
    const correctKey = c.type === 'mcq_single' ? c.answer_key.correct : typeof rawCorrect === 'string' ? rawCorrect : JSON.stringify(rawCorrect ?? '');
    const exp = c.explanation ? (vi ? (c.explanation.vi ?? c.explanation.en ?? '') : (c.explanation.en ?? c.explanation.vi ?? '')) : '';
    const others: Record<string, string> = {};
    if (c.type === 'mcq_single') {
      for (const o of c.options) {
        if (o.key === correctKey) continue;
        others[o.key] = vi ? `"${o.text || o.key}" không khớp với dấu hiệu ngữ pháp/ngữ cảnh trong câu.` : `"${o.text || o.key}" does not match the grammatical or contextual cue in the sentence.`;
      }
    }
    const tag = c.tags?.[0] ?? 'general';
    return {
      correct_option: correctKey,
      why_correct: exp || (vi ? `Đáp án ${correctKey} đúng theo ngữ cảnh câu.` : `Option ${correctKey} fits the sentence context.`),
      why_others_wrong: others,
      how_to_spot: vi ? 'Tìm dấu hiệu thời gian, từ loại cần điền và cặp từ đi kèm trước khi đọc các lựa chọn.' : 'Look for time markers, the required part of speech and collocations before reading the options.',
      related_points: [{ type: 'grammar', code: tag, label: tag.replace(/^[a-z]+:/, '').replace(/-/g, ' ') }],
      tested_point: tag,
      chosen_option_trap: chosen && chosen !== correctKey ? (vi ? `Lựa chọn ${chosen} là bẫy phổ biến: cùng gốc từ nhưng sai từ loại hoặc sai thì.` : `Option ${chosen} is a common trap: same root but wrong form or tense.`) : null,
      key_vocab: c.type === 'mcq_single' && c.stem ? [{ term: c.stem.split(' ').find((w) => w.length > 7)?.replace(/[^a-zA-Z]/g, '') ?? 'proposal', reading: null, meaning: vi ? 'đề xuất, bản kế hoạch' : 'a formal plan or suggestion' }] : [],
      locale,
      cached,
      ai_task_id: aiTaskId,
    };
  };

  /** Đầu ra diagnose_rl tự biên soạn từ bài làm (dạng sai nhiều nhất theo Part × kỹ năng con, như MockProvider của API) */
  const buildDiagnosis = (a: MockAttemptRecord, lang: string): Pick<AttemptAiDiagnosis, 'top_error_type' | 'evidence' | 'why' | 'steps' | 'check_question' | 'encouragement'> => {
    const vi = lang === 'vi';
    const byType: Record<string, { correct: number; total: number }> = {};
    const wrong: { key: string; q: MockQuestion; chosen: string | null }[] = [];
    for (const q of questionsOf(a)) {
      const rec = a.answers[q.question_id];
      const ok = grade(q.content, rec?.answer ?? null).is_correct === true;
      const subs = subskillsOf(q);
      const keys = subs.length ? subs.map((x) => `${q.section_code}:${x}`) : [`${q.section_code}:${q.content.type}`];
      for (const k of keys) {
        const m = (byType[k] ??= { correct: 0, total: 0 });
        m.total++;
        if (ok) m.correct++;
      }
      if (!ok) wrong.push({ key: keys[0]!, q, chosen: rec?.answer.type === 'mcq_single' ? (rec.answer.selected ?? null) : null });
    }
    const ranked = Object.entries(byType).sort((x, y) => x[1].correct / x[1].total - y[1].correct / y[1].total || y[1].total - x[1].total);
    const [type, stat] = ranked[0] ?? ['part5:vocabulary_context', { correct: 0, total: 0 }];
    const miss = stat.total - stat.correct;
    const ev = wrong.find((w) => w.key === type && !isSpokenTextSection('toeic', w.q.section_code)) ?? wrong.find((w) => !isSpokenTextSection('toeic', w.q.section_code));
    const stem = ev && 'stem' in ev.q.content && typeof ev.q.content.stem === 'string' ? ev.q.content.stem.replace(/\s+/g, ' ').slice(0, 120) : null;
    const correct = ev ? correctAnswerOf(ev.q.content) : null;
    const evidence = stem
      ? vi
        ? `"${stem}" – bạn chọn ${ev?.chosen ?? '—'}, đáp án ${typeof correct === 'string' ? correct : '—'}.`
        : `"${stem}" – you chose ${ev?.chosen ?? '—'}, the answer is ${typeof correct === 'string' ? correct : '—'}.`
      : vi
        ? `Sai ${miss}/${stat.total} câu thuộc nhóm này.`
        : `Missed ${miss}/${stat.total} questions of this type.`;
    return {
      top_error_type: type,
      evidence: [evidence.slice(0, 240)],
      why: vi
        ? `Bạn sai ${miss}/${stat.total} câu dạng này: thường do chọn theo nghĩa quen thuộc mà bỏ qua dấu hiệu ngữ pháp quanh chỗ trống.`
        : `You missed ${miss}/${stat.total} of these: usually picking a familiar meaning while ignoring the grammar cue around the blank.`,
      steps: vi
        ? ['Gạch chân từ đứng ngay trước và sau chỗ trống', 'Xác định từ loại hoặc thì cần điền trước khi đọc lựa chọn', 'Đọc lại cả câu với đáp án đã chọn để kiểm tra nghĩa']
        : ['Underline the words right before and after the blank', 'Decide the part of speech or tense needed before reading the options', 'Re-read the whole sentence with your choice to check the meaning'],
      check_question: {
        stem: 'The shipment will be delivered ______ the end of the week.',
        options: ['by', 'until', 'since', 'during'],
        answer: 'by',
        explanation: vi ? '"by + mốc thời gian" = trước hoặc đúng thời hạn.' : '"by + a point in time" means no later than that time.',
      },
      encouragement: vi ? 'Bạn làm tốt các câu đọc hiểu chi tiết – giữ nhịp 20 phút mỗi ngày nhé!' : 'You handled the detail questions well – keep up 20 minutes a day!',
    };
  };

  const sse = (events: { event: string; data: unknown; delayMs?: number }[]): Response => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        for (const e of events) {
          if (e.delayMs) await sleep(e.delayMs);
          controller.enqueue(encoder.encode(`event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`));
        }
        controller.close();
      },
    });
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
  };

  // S9: chẩn đoán, lộ trình, hôm nay, check-in/điều chỉnh, chuỗi ngày/XP/huy hiệu
  const learning = learningPlanMock({
    state,
    persist,
    route: route,
    json,
    error,
    uuid,
    nowIso,
    requireUser,
    isPro,
    publicQuestion: (q) => publicQuestion(q, 'attempt'),
    finishAttempt: (a) => {
      a.result = gradeAttempt(a);
    },
    sectionQuestions: (code) => [...new Map(bankQuestions().filter((q) => q.section_code === code).map((q) => [q.question_id, q])).values()],
    toAttemptDto,
    quotaExceeded,
    consumeQuota,
  });

  // S10: ôn thẻ FSRS, bộ từ, sổ lỗi + drill, thống kê/dự báo, phễu, đăng ký chờ (đặt trước routes S9/S6 – đè bản tạm)
  const s10 = s10Mock<Route>({
    state,
    persist,
    route,
    json,
    error,
    uuid,
    nowIso,
    requireUser,
    isPro,
    quotaExceeded,
    consumeQuota,
    quotaLimit: (u, feature) => quotaFor(u, feature)?.limit ?? null,
    usage: (userId, feature) => usageOf(userId, feature, quotaFor(state.users[userId]!, feature)?.period ?? 'day'),
    resetAt: resetAtOf,
    questionById: (id) => allQuestions().find((q) => q.question_id === id),
    publicQuestion: (q) => publicQuestion(q, 'review'),
    toAttemptDto,
    openExamId: (userId) => Object.values(state.attempts).find((a) => a.user_id === userId && a.status === 'in_progress' && a.mode === 'exam')?.id ?? null,
  });

  // S12: beta kín, khảo sát/NPS, góp ý + ảnh, báo lỗi câu, hỗ trợ, pháp lý, MFA, admin vận hành (đặt TRƯỚC S10: đè /waitlist)
  const s12 = s12Mock<Route>({
    state,
    persist,
    route,
    json,
    error,
    uuid,
    nowIso,
    requireUser,
    currentUser,
    publicUser,
    flagOn: (key) => mockFlagOn(key),
    isPro,
    questionByVersion: (qv) => {
      const q = allQuestions().find((x) => x.question_version_id === qv);
      return q ? { question_id: q.question_id, section_code: q.section_code, stem: q.content.stem ?? null, external_ref: null } : undefined;
    },
  });

  // B2: hàng chờ duyệt, nhập Excel, AI soạn đề nháp, phát hành đề nháp
  const contentTools = contentToolsMock<Route>({ state, persist, route, json, error, uuid, nowIso, currentUser });

  const routes: Route[] = [
    // --------------------------------------------------------------------- S12
    ...s12.routes,
    // --------------------------------------------------------------------- B2
    ...contentTools.routes,
    // --------------------------------------------------------------------- auth
    route('POST', '/auth/guest', () => {
      const user = makeUser({ is_guest: true, guest_token: `guest_${uuid()}` });
      state.users[user.id] = user;
      state.sessionUserId = user.id;
      persist();
      const expires_at = new Date(Date.now() + 30 * 86_400_000).toISOString();
      return json(201, { guest_token: user.guest_token, expires_at, user: publicUser(user), access_token: 'mock-access', expires_in: 900 });
    }),
    route('POST', '/auth/register', ({ body, headers }) => {
      const b = body as { email?: string; password?: string; display_name?: string; guest_token?: string; ui_locale?: string; referral_code?: string; attribution?: Record<string, unknown> };
      if (!b.email || !b.password || !b.display_name) return error(400, 'validation_failed', 'Missing fields', { fields: { email: 'required' } });
      // S12 (API): chính sách mật khẩu – ≥ 12 ký tự, không phổ biến/lộ, không quá dễ đoán
      const pwIssue = mockPasswordIssue(b.password, [b.email, b.display_name]);
      if (pwIssue) return error(400, 'validation_failed', 'Password does not meet the policy', { issues: [{ path: 'password', code: pwIssue, message: pwIssue }], min_length: MOCK_PASSWORD_MIN });
      if (Object.values(state.users).some((u) => u.email?.toLowerCase() === b.email!.toLowerCase())) return error(409, 'conflict', 'Email already registered');
      const guest = b.guest_token ? Object.values(state.users).find((u) => u.guest_token === b.guest_token) : undefined;
      const user = makeUser({
        is_guest: false,
        email: b.email,
        password: b.password,
        display_name: b.display_name,
        ui_locale: (b.ui_locale as User['ui_locale']) ?? 'vi',
        // S10: attribution lần chạm đầu (chỉ lưu khi tạo tài khoản)
        attribution: b.attribution ?? null,
      });
      state.users[user.id] = user;
      if (guest) {
        // Ghép tiến độ khách → tài khoản mới
        for (const a of Object.values(state.attempts)) if (a.user_id === guest.id) a.user_id = user.id;
        state.xp[user.id] = (state.xp[user.id] ?? 0) + (state.xp[guest.id] ?? 0);
        state.enrollments[user.id] = state.enrollments[guest.id] ?? [];
        learning.merge(guest.id, user.id);
        delete state.users[guest.id];
      }
      referral.onRegistered(user, b.referral_code, headers.get('x-device-fingerprint'));
      state.sessionUserId = user.id;
      persist();
      return json(201, { access_token: 'mock-access', expires_in: 900, user: publicUser(user) });
    }),
    route('POST', '/auth/login', ({ body }) => {
      const b = body as { email?: string; password?: string; guest_token?: string };
      const user = Object.values(state.users).find((u) => u.email?.toLowerCase() === b.email?.toLowerCase() && u.password === b.password);
      if (!user) return error(401, 'unauthorized', 'Invalid credentials');
      const guest = b.guest_token ? Object.values(state.users).find((u) => u.guest_token === b.guest_token && u.id !== user.id) : undefined;
      if (guest) {
        for (const a of Object.values(state.attempts)) if (a.user_id === guest.id) a.user_id = user.id;
        state.xp[user.id] = (state.xp[user.id] ?? 0) + (state.xp[guest.id] ?? 0);
        learning.merge(guest.id, user.id);
        delete state.users[guest.id];
      }
      state.sessionUserId = user.id;
      persist();
      return json(200, { access_token: 'mock-access', expires_in: 900, user: publicUser(user) });
    }),
    // OTP email (mock): mã cố định 123456; sai 5 lần → 429
    route('POST', '/auth/otp/request', ({ body }) => {
      const b = body as { email?: string; phone?: string };
      if (!b.email && !b.phone) return error(400, 'validation_failed', 'Provide exactly one of phone or email');
      return json(202, { status: 'sent', channel: b.email ? 'email' : 'zalo', retry_after: 60, expires_in: 300 });
    }),
    route('POST', '/auth/otp/verify', ({ body, headers }) => {
      const b = body as { email?: string; otp?: string; display_name?: string; guest_token?: string; referral_code?: string; attribution?: Record<string, unknown> };
      if (b.otp !== '123456') return error(401, 'unauthorized', 'Invalid OTP', { reason: 'otp_invalid', attempts_left: 4 });
      let user = Object.values(state.users).find((u) => u.email?.toLowerCase() === b.email?.toLowerCase());
      if (!user) {
        user = makeUser({ is_guest: false, email: b.email ?? null, display_name: b.display_name ?? (b.email ?? 'user').split('@')[0]!, attribution: b.attribution ?? null });
        state.users[user.id] = user;
        referral.onRegistered(user, b.referral_code, headers.get('x-device-fingerprint'));
      }
      const guest = b.guest_token ? Object.values(state.users).find((u) => u.guest_token === b.guest_token && u.id !== user.id) : undefined;
      if (guest) {
        for (const a of Object.values(state.attempts)) if (a.user_id === guest.id) a.user_id = user.id;
        learning.merge(guest.id, user.id);
        delete state.users[guest.id];
      }
      state.sessionUserId = user.id;
      persist();
      return json(200, { access_token: 'mock-access', expires_in: 900, user: publicUser(user) });
    }),
    route('POST', '/auth/logout', () => {
      state.sessionUserId = null;
      persist();
      return empty(204);
    }),
    route('POST', '/auth/refresh', () => (currentUser() ? json(200, { access_token: 'mock-access', expires_in: 900 }) : error(401, 'unauthorized', 'No session'))),

    // --------------------------------------------------------------------- me
    route('GET', '/me', () => {
      const u = requireUser();
      return u instanceof Response ? u : json(200, publicUser(u));
    }),
    route('PATCH', '/me', ({ body }) => {
      const u = requireUser();
      if (u instanceof Response) return u;
      const b = body as Partial<MockUserRecord>;
      Object.assign(u, { display_name: b.display_name ?? u.display_name, ui_locale: b.ui_locale ?? u.ui_locale, explain_locale: b.explain_locale ?? u.explain_locale, active_program: b.active_program ?? u.active_program });
      // C1: chọn chương trình đang học → tạo enrollment nếu chưa có (như API, mục tiêu giữ nguyên)
      if (b.active_program) {
        const list = (state.enrollments[u.id] ??= []);
        if (!list.some((e) => e.program === b.active_program))
          list.push({ id: uuid(), program: b.active_program, target_score: null, target_level: null, exam_date: null, daily_minutes: 30, current_level: null, days_to_exam: null, diagnostic_attempt_id: null, started_at: nowIso() });
      }
      persist();
      return json(200, publicUser(u));
    }),
    route('GET', '/me/stats', ({ url }) => {
      const u = requireUser();
      if (u instanceof Response) return u;
      const program = url.searchParams.get('program') ?? 'toeic';
      const graded = Object.values(state.attempts)
        .filter((a) => a.user_id === u.id && a.result && a.program === program)
        .sort((x, y) => (x.submitted_at ?? '').localeCompare(y.submitted_at ?? ''));
      const latest = graded[graded.length - 1];
      const enrollment = (state.enrollments[u.id] ?? []).find((e) => e.program === program);
      const stats: Stats = {
        program,
        current_estimate: latest?.result?.scaled_score ?? null,
        target: enrollment?.target_score ?? null,
        trend_30d: graded.filter((a) => a.result?.scaled_score != null).map((a) => ({ date: (a.submitted_at ?? '').slice(0, 10), score: a.result!.scaled_score! })),
        by_skill: {},
        by_section: latest?.result?.by_section ?? {},
        by_question_type: latest?.result?.by_question_type ?? {},
        weakest: [],
        minutes_this_week: graded.length * 8,
        // S9: chuỗi theo múi giờ (đóng băng Pro), XP hôm nay/cấp, huy hiệu, tóm tắt lộ trình (thay bản S0 đếm ngày có bài nộp)
        ...learning.statsExtras(u),
        // S10: điểm theo thời gian, độ chính xác 30 ngày vs trước, phút/tuần, từ vựng, lỗi, cộng đồng
        ...s10.statsExtras(u, program),
      };
      return json(200, stats);
    }),
    route('GET', '/me/entitlements', ({ url }) => {
      const u = requireUser();
      if (u instanceof Response) return u;
      const program = url.searchParams.get('program') ?? 'toeic';
      // Như API v1.1: remaining = limit − used (không âm), reset_at = 00:00 giờ VN của kỳ sau
      const ent: Entitlements & { plan_kind: string } = {
        program,
        is_pro: isPro(u),
        plan_kind: u.plan_kind ?? (isPro(u) ? 'monthly' : 'free'),
        features: isPro(u) ? PRO_FEATURES : FREE_FEATURES,
        quotas: DEFAULT_QUOTAS.filter((q) => q.plan_kind === planOf(u)).map((q) => {
          const used = usageOf(u.id, q.feature, q.period);
          return { feature: q.feature, period: q.period, limit: q.limit, used, remaining: Math.max(0, q.limit - used), reset_at: resetAtOf(q.period) };
        }),
        credits: state.credits[u.id] ?? 0,
      };
      return json(200, ent);
    }),
    route('GET', '/me/attempts', ({ url }) => {
      const u = requireUser();
      if (u instanceof Response) return u;
      const program = url.searchParams.get('program');
      const status = url.searchParams.get('status');
      const mode = url.searchParams.get('mode');
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      const day = (iso: string) => iso.slice(0, 10);
      const data: AttemptSummary[] = Object.values(state.attempts)
        .filter((a) => a.user_id === u.id && (!program || a.program === program))
        .filter((a) => (!status || a.status === status) && (!mode || a.mode === mode) && (!from || day(a.started_at) >= from) && (!to || day(a.started_at) <= to))
        .sort((x, y) => y.started_at.localeCompare(x.started_at))
        .map((a) => ({
          id: a.id,
          program: a.program,
          mode: a.mode,
          status: a.status,
          test_set_title: findTestSet(a.test_set_id)?.title ?? null,
          raw_score: a.result?.raw_score ?? null,
          scaled_score: a.result?.scaled_score ?? null,
          started_at: a.started_at,
          submitted_at: a.submitted_at,
        }));
      return json(200, { data, next_cursor: null });
    }),
    route('GET', '/me/enrollments', () => {
      const u = requireUser();
      return u instanceof Response ? u : json(200, (state.enrollments[u.id] ?? []).map((e) => ({ ...e, is_active: true, is_current: e.program === (u.active_program ?? 'toeic') })));
    }),
    route('POST', '/me/enrollments', ({ body }) => {
      const u = requireUser();
      if (u instanceof Response) return u;
      const b = body as { program: string; target_score?: number; exam_date?: string; daily_minutes?: number };
      const list = (state.enrollments[u.id] ??= []);
      if (list.some((e) => e.program === b.program)) return error(409, 'conflict', 'Already enrolled');
      const e = {
        id: uuid(),
        program: b.program,
        target_score: b.target_score ?? null,
        target_level: null,
        exam_date: b.exam_date ?? null,
        daily_minutes: b.daily_minutes ?? 30,
        current_level: null,
        days_to_exam: b.exam_date ? Math.max(0, Math.ceil((new Date(b.exam_date).getTime() - Date.now()) / 86_400_000)) : null,
        diagnostic_attempt_id: null,
        started_at: nowIso(),
      } as (typeof list)[number];
      list.push(e);
      persist();
      return json(201, e);
    }),
    route('PATCH', '/me/enrollments/{program}', ({ params, body }) => {
      const u = requireUser();
      if (u instanceof Response) return u;
      const e = (state.enrollments[u.id] ?? []).find((x) => x.program === params.program);
      if (!e) return error(404, 'not_found', 'Enrollment not found');
      const b = body as { target_score?: number; exam_date?: string; daily_minutes?: number };
      if (b.target_score !== undefined) e.target_score = b.target_score;
      if (b.exam_date !== undefined) e.exam_date = b.exam_date;
      if (b.daily_minutes !== undefined) e.daily_minutes = b.daily_minutes;
      e.days_to_exam = e.exam_date ? Math.max(0, Math.ceil((new Date(e.exam_date).getTime() - Date.now()) / 86_400_000)) : null;
      persist();
      return json(200, e);
    }),

    // --------------------------------------------------------------------- catalog
    route('GET', '/programs/{program}/test-sets', ({ params, url }) => {
      const u = currentUser();
      const kind = url.searchParams.get('kind');
      // C1/C2: IELTS có đề mẫu các dạng câu; JLPT/HSK chưa có nội dung
      const sets = params.program === 'toeic' ? MOCK_TEST_SETS : params.program === 'ielts' ? MOCK_IELTS_TEST_SETS : [];
      const data = sets.filter((t) => !kind || t.kind === kind).map((t) => summarize(t, u?.id ?? null));
      return json(200, { data, next_cursor: null });
    }),
    route('GET', '/test-sets/{testSetId}', ({ params }) => {
      const t = findTestSet(params.testSetId!);
      if (!t) return error(404, 'not_found', 'Test set not found');
      const u = currentUser();
      const inProgress = u ? Object.values(state.attempts).find((a) => a.user_id === u.id && a.test_set_id === t.id && a.status === 'in_progress') : undefined;
      return json(200, {
        ...summarize(t, u?.id ?? null),
        sections: t.sections.map((s) => ({ id: uuid(), code: s.code, skill: s.skill, name: s.name, level: null, duration_sec: s.duration_sec, question_count: s.question_count, rules: {} })),
        in_progress_attempt_id: inProgress?.id ?? null,
      });
    }),

    // --------------------------------------------------------------------- attempts
    route('POST', '/attempts', ({ body, headers }) => {
      const u = requireUser();
      if (u instanceof Response) return u;
      const b = body as { program: string; mode: AttemptMode; test_set_id?: string; section_id?: string; plan_task_id?: string };
      // S9: lượt luyện 10 câu theo section (task lộ trình) – Idempotency-Key / plan_task_id trả lại lượt đang làm
      if (!b.test_set_id && b.section_id) return learning.createSectionAttempt(u, b, headers.get('idempotency-key')) ?? error(404, 'not_found', 'Section not found');
      const t = b.test_set_id ? findTestSet(b.test_set_id) : undefined;
      if (!t) return error(404, 'not_found', 'Test set not found');
      if (t.locked && !isPro(u)) return error(403, 'forbidden', 'Pro plan required', { feature: 'full_test', upgrade: true });
      const feature = t.kind === 'full' ? 'full_test' : t.kind === 'part_drill' ? 'part_drill' : 'mini_test';
      const existing = Object.values(state.attempts).find((a) => a.user_id === u.id && a.test_set_id === t.id && a.status === 'in_progress');
      if (existing) {
        if (b.plan_task_id && !existing.plan_task_id) {
          existing.plan_task_id = b.plan_task_id;
          persist();
        }
        return json(201, toAttemptDto(existing));
      }
      const over = quotaExceeded(u, feature);
      if (over) return over;
      consumeQuota(u, feature);
      const started = Date.now();
      const rec: MockAttemptRecord = {
        id: uuid(),
        user_id: u.id,
        test_set_id: t.id,
        program: b.program,
        mode: b.mode,
        status: 'in_progress',
        started_at: new Date(started).toISOString(),
        expires_at: b.mode === 'exam' && t.duration_sec ? new Date(started + t.duration_sec * 1000).toISOString() : null,
        submitted_at: null,
        answers: {},
        section_elapsed_sec: {},
        ui_state: {},
        events: [],
        result: null,
        plan_task_id: b.plan_task_id ?? null,
      };
      state.attempts[rec.id] = rec;
      persist();
      return json(201, toAttemptDto(rec));
    }),
    // Luyện theo Part (mock): lấy đề mini của Part; có từ khoá thì phải có câu khớp đề bài, nếu không 404
    route('GET', '/practice/questions', ({ url }) => {
      const u = requireUser();
      if (u instanceof Response) return u;
      const section = url.searchParams.get('section') ?? 'part5';
      const q = (url.searchParams.get('q') ?? '').toLowerCase();
      const count = Math.min(50, Math.max(1, Number(url.searchParams.get('count') ?? 10) || 10));
      const timed = url.searchParams.get('timed') === 'true';
      const perQuestion = Number(url.searchParams.get('per_question_sec') ?? '') || undefined;
      const t = MOCK_TEST_SETS.find((x) => x.questions.some((qq) => qq.section_code === section));
      if (!t) return error(404, 'not_found', 'No questions');
      // Câu của Part từ mọi đề (không trùng; mock không ngẫu nhiên để E2E ổn định), từ khoá lọc theo nội dung.
      // Nhóm cùng passage (Part 3/4/6/7) lấy trọn nhóm, liền nhau; nhóm không vừa `count` thì bỏ (trừ nhóm đầu) – như API
      const unique = [...new Map(bankQuestions().filter((qq) => qq.section_code === section && (!q || JSON.stringify(qq.content).toLowerCase().includes(q))).map((qq) => [qq.question_id, qq])).values()];
      const picked: MockQuestion[] = [];
      for (const qq of unique) {
        if (picked.includes(qq)) continue;
        const group = qq.group_key ? unique.filter((x) => x.group_key === qq.group_key) : [qq];
        if (picked.length + group.length > count && picked.length > 0) continue;
        picked.push(...group);
        if (picked.length >= count) break;
      }
      if (!picked.length) return error(404, 'not_found', 'No questions');
      const started = Date.now();
      const rec: MockAttemptRecord = {
        id: uuid(),
        user_id: u.id,
        test_set_id: t.id,
        question_ids: picked.map((qq) => qq.question_id),
        program: 'toeic',
        mode: timed ? 'timed_drill' : 'drill',
        status: 'in_progress',
        started_at: new Date(started).toISOString(),
        // Như API: Σ giây theo Part (TIMED_DRILL_SEC_PER_QUESTION) hoặc per_question_sec × số câu
        // v1.1 S5: + thời lượng audio của câu + pause_ms + audio nhóm (một lần mỗi nhóm) – timedDrillBudgetSeconds như API
        expires_at: timed
          ? new Date(
              started +
                timedDrillBudgetSeconds(
                  picked.map((x) => {
                    const audio = x.media.find((m) => m.kind === 'audio');
                    const media = 'media' in x.content ? (x.content.media as { pause_ms?: number } | undefined) : undefined;
                    return { section_code: x.section_code, group_key: x.group_key, has_audio: !!audio, audio_ms: audio?.duration_ms ?? null, has_group_audio: !!x.passage?.media_url, group_audio_ms: null, pause_ms: media?.pause_ms ?? null };
                  }),
                  perQuestion,
                ) *
                  1000,
            ).toISOString()
          : null,
        submitted_at: null,
        answers: {},
        section_elapsed_sec: {},
        ui_state: {},
        events: [],
        result: null,
      };
      state.attempts[rec.id] = rec;
      persist();
      return json(201, toAttemptDto(rec));
    }),
    route('GET', '/attempts/{attemptId}', ({ params }) => {
      const u = requireUser();
      if (u instanceof Response) return u;
      const a = state.attempts[params.attemptId!];
      if (!a || a.user_id !== u.id) return error(404, 'not_found', 'Attempt not found');
      return json(200, toAttemptDto(a));
    }),
    route('PUT', '/attempts/{attemptId}/answers', ({ params, body }) => {
      const u = requireUser();
      if (u instanceof Response) return u;
      const a = state.attempts[params.attemptId!];
      if (!a || a.user_id !== u.id) return error(404, 'not_found', 'Attempt not found');
      if (a.status !== 'in_progress') return error(409, 'conflict', 'Attempt already submitted');
      // Quá hạn + ân hạn 30 s → 409 (như API)
      if (a.expires_at && Date.now() > Date.parse(a.expires_at) + ATTEMPT_GRACE_SECONDS * 1000) return error(409, 'conflict', 'Attempt has expired', { expires_at: a.expires_at });
      const b = body as { answers?: { question_id: string; answer: unknown; time_spent_ms?: number; flagged?: boolean }[]; section_elapsed_sec?: Record<string, number>; ui_state?: Record<string, unknown> };
      // C3: đồng hồ theo section – đáp án vào section đã hết giờ → 409 section_locked (cả lô bị từ chối, client bỏ các câu đó)
      const clock = mockSectionClock(a, findTestSet(a.test_set_id), questionsOf(a));
      const sectionOfQ = new Map(questionsOf(a).map((q) => [q.question_id, q.section_code]));
      // Như API: lưu phần hợp lệ của lô, câu thuộc section đã khoá → 409 conflict + details.reason = section_locked
      const lockedCodes = [...new Set((b.answers ?? []).map((x) => sectionOfQ.get(x.question_id)).filter((c): c is string => !!c && !!clock.get(c)?.locked))];
      for (const ans of b.answers ?? []) {
        if (lockedCodes.includes(sectionOfQ.get(ans.question_id) ?? '')) continue;
        const parsed = answerInputSchema.safeParse(ans.answer);
        if (!parsed.success) return error(400, 'validation_failed', 'Invalid answer', { question_id: ans.question_id });
        const prev = a.answers[ans.question_id];
        a.answers[ans.question_id] = { answer: parsed.data, time_spent_ms: ans.time_spent_ms ?? prev?.time_spent_ms, flagged: ans.flagged ?? prev?.flagged };
      }
      if (b.section_elapsed_sec) Object.assign(a.section_elapsed_sec, b.section_elapsed_sec);
      if (b.ui_state) {
        // Như API: attemptUiStateSchema (current_question_id, current_section_code, listening {step, offset_ms}); gộp nông
        const ui = attemptUiStateSchema.safeParse(b.ui_state);
        if (!ui.success) return error(400, 'validation_failed', 'Invalid ui_state', { issues: ui.error.issues.map((i) => i.path.join('.')) });
        a.ui_state = { ...a.ui_state, ...ui.data };
      }
      persist();
      if (lockedCodes.length) return error(409, 'conflict', 'Section time is over', { reason: 'section_locked', section_code: lockedCodes[0], section_codes: lockedCodes });
      return empty(204);
    }),
    route('POST', '/attempts/{attemptId}/events', ({ params, body }) => {
      const parsed = attemptEventSchema.safeParse(body);
      if (!parsed.success) return error(400, 'validation_failed', 'Invalid event', { issues: parsed.error.issues.map((i) => i.path.join('.')) });
      const a = state.attempts[params.attemptId!];
      if (a) {
        a.events.push({ type: parsed.data.type, at: parsed.data.at ?? nowIso(), meta: parsed.data.meta });
        // audio_started (+ audio_played cũ) với question_id → đếm lượt nghe (giữ "nghe một lần" khi tải lại – như API)
        const qid = typeof parsed.data.meta?.question_id === 'string' ? parsed.data.meta.question_id : null;
        if ((parsed.data.type === 'audio_started' || parsed.data.type === 'audio_played') && qid && a.status === 'in_progress') {
          a.audio_plays = { ...a.audio_plays, [qid]: (a.audio_plays?.[qid] ?? 0) + 1 };
        }
        if (a.events.length > 500) a.events.shift();
        persist();
      }
      return empty(202);
    }),
    route('POST', '/attempts/{attemptId}/submit', ({ params }) => {
      const u = requireUser();
      if (u instanceof Response) return u;
      const a = state.attempts[params.attemptId!];
      if (!a || a.user_id !== u.id) return error(404, 'not_found', 'Attempt not found');
      if (a.result) return json(200, a.result); // idempotent
      a.result = gradeAttempt(a);
      a.status = 'graded';
      a.submitted_at = nowIso();
      // S8: bài chấm đầu tiên của người được giới thiệu → referral started (thưởng 200/200)
      referral.onAttemptGraded(u.id);
      // S9: task lộ trình tự done (plan_task_id), chuỗi ngày, huy hiệu (+ thông báo in-app)
      learning.onAttemptGraded(a);
      // S10: câu sai → sổ lỗi (gộp theo câu)
      s10.onAttemptGraded(a, questionsOf(a));
      persist();
      return json(200, a.result);
    }),
    route('GET', '/attempts/{attemptId}/result', ({ params }) => {
      const u = requireUser();
      if (u instanceof Response) return u;
      const a = state.attempts[params.attemptId!];
      if (!a || a.user_id !== u.id) return error(404, 'not_found', 'Attempt not found');
      if (!a.result) return error(409, 'conflict', 'Attempt not submitted yet');
      return json(200, a.result);
    }),
    // URL ký mới cho mọi media của attempt (v1.1 – Sprint 4); mọi trạng thái (Review nghe lại)
    route('GET', '/attempts/{attemptId}/media', ({ params }) => {
      const u = requireUser();
      if (u instanceof Response) return u;
      const a = state.attempts[params.attemptId!];
      if (!a || a.user_id !== u.id) return error(404, 'not_found', 'Attempt not found');
      const sig = `r${++refreshCounter}`;
      const seen = new Map<string, { id: string; kind: string; url: string; expires_at: string }>();
      // C3: Exam Mode IELTS đang làm – part đã nghe xong không được cấp lại URL (nghe một lần, ràng buộc phía server)
      const blocked = a.status === 'in_progress' ? playedAssets(mockExamFormat(a, findTestSet(a.test_set_id), questionsOf(a))) : new Set<string>();
      for (const q of questionsOf(a)) {
        for (const m of q.media) seen.set(m.id, { id: m.id, kind: m.kind, ...signUrl(m.url, sig) });
        if (q.passage?.media_asset_id && q.passage.media_url && !blocked.has(q.passage.media_asset_id)) seen.set(q.passage.media_asset_id, { id: q.passage.media_asset_id, kind: 'audio', ...signUrl(q.passage.media_url, sig) });
      }
      return json(200, { data: [...seen.values()] }, { 'Cache-Control': 'no-store' });
    }),
    route('GET', '/attempts/{attemptId}/review', ({ params, url, locale }) => {
      const u = requireUser();
      if (u instanceof Response) return u;
      const a = state.attempts[params.attemptId!];
      if (!a || a.user_id !== u.id) return error(404, 'not_found', 'Attempt not found');
      if (!a.result) return error(409, 'conflict', 'Attempt not submitted yet');
      // Lọc kết hợp như API: only_wrong (is_correct === false), flagged, section
      const onlyWrong = url.searchParams.get('only_wrong') === 'true';
      const flaggedOnly = url.searchParams.get('flagged') === 'true';
      const section = url.searchParams.get('section');
      const items: AttemptReview['items'] = [];
      const reviewNums = mockNumbering(a.program, questionsOf(a));
      for (const q of questionsOf(a)) {
        const rec = a.answers[q.question_id];
        const g = grade(q.content, rec?.answer ?? null);
        if (onlyWrong && g.is_correct !== false) continue;
        if (flaggedOnly && !rec?.flagged) continue;
        if (section && q.section_code !== section) continue;
        const chosen = rec?.answer.type === 'mcq_single' ? (rec.answer.selected ?? '') : '';
        const cacheKey = `${q.question_version_id}:${chosen}:${u.explain_locale ?? locale}`;
        items.push({
          question: publicQuestion(q, 'review', reviewNums.get(q.question_id)),
          your_answer: rec?.answer ?? null,
          correct_answer: g.correct_answer,
          is_correct: g.is_correct,
          score: g.score,
          time_spent_ms: rec?.time_spent_ms ?? null,
          flagged: rec?.flagged ?? false,
          details: g.details ?? null,
          // Như API: giải thích cache kèm Review không có ai_task_id (đánh giá → gọi lại /ai/explain lấy ai_task_id)
          explanation: state.explanations[cacheKey] ? { ...state.explanations[cacheKey], ai_task_id: null, cached: true } : null,
          transcript_highlight: transcriptOf(q),
          audio_plays: a.audio_plays?.[q.question_id] ?? 0,
          error_entry_id: null,
          community_correct_rate: q.community_correct_rate,
          // S6: ghi chú của người học cho câu này
          note: latestNoteFor(state, u.id, q.question_version_id, a.id),
        });
      }
      return json(200, { attempt_id: a.id, items });
    }),

    // --------------------------------------------------------------------- ai
    route('POST', '/ai/explain', async ({ body, locale }) => {
      const u = requireUser();
      if (u instanceof Response) return u;
      const b = body as { question_version_id: string; chosen_option?: string; attempt_id?: string; answer?: { type: string } };
      const q = allQuestions().find((x) => x.question_version_id === b.question_version_id);
      if (!q) return error(404, 'not_found', 'Question version not found');
      // Exam Mode: đang có bài thi chưa nộp → 403, kể cả cache hit (CLAUDE.md §5.8)
      if (examInProgress(u.id)) return error(403, 'exam_mode_locked', 'Explanations are locked during an exam');
      const lang = u.explain_locale ?? locale;
      // C2: dạng nhiều mục – khoá theo câu trả lời (API băm câu trả lời; mock dùng JSON)
      const choice = b.answer && b.answer.type !== 'mcq_single' ? JSON.stringify(b.answer) : (b.chosen_option ?? '');
      const cacheKey = `${b.question_version_id}:${choice}:${lang}`;
      const cached = state.explanations[cacheKey];
      if (cached) {
        // Như API: mỗi lượt trúng cache ghi một ai_task (cache_hit) → ai_task_id MỚI để đánh giá; không trừ quota
        const hitId = recordTask(u.id, 'explain_mcq');
        persist();
        return json(200, { ...cached, cached: true, ai_task_id: hitId });
      }
      const over = quotaExceeded(u, 'ai_explain');
      if (over) return over;
      consumeQuota(u, 'ai_explain');
      const aiTaskId = recordTask(u.id, 'explain_mcq');
      const explanation: Explanation = { ...buildExplanation(q, b.chosen_option, lang, aiTaskId, false), prompt_version_id: PROMPT_VERSION.explain_mcq };
      const { locale: _l, cached: _c, ai_task_id: _a, prompt_version_id: _p, ...output } = explanation;
      const fail = takeMockAiFailure();
      if (fail) {
        // Lỗi AI giữa chừng → hoàn quota, không lưu cache (như ExplainService.refund)
        refundQuota(u, 'ai_explain');
        persist();
        return sse([{ event: 'start', data: { ai_task_id: aiTaskId, cached: false } }, ...jsonDeltas(output).slice(0, 3), { event: 'error', data: { code: fail, message: fail === 'ai_timeout' ? 'timeout' : 'provider_error' }, delayMs: 150 }, { event: 'done', data: {} }]);
      }
      state.explanations[cacheKey] = { ...explanation, cached: true };
      persist();
      return sse([{ event: 'start', data: { ai_task_id: aiTaskId, cached: false } }, ...jsonDeltas(output), { event: 'result', data: { data: explanation, ai_task_id: aiTaskId, cached: false }, delayMs: 120 }, { event: 'done', data: {} }]);
    }),
    // ai.feedback: chỉ chủ tác vụ; gửi lại cùng ai_task_id → cập nhật (updated: true)
    route('POST', '/ai/feedback', ({ body }) => {
      const u = requireUser();
      if (u instanceof Response) return u;
      const parsed = aiFeedbackInputSchema.safeParse(body);
      if (!parsed.success) return error(400, 'validation_failed', 'Invalid feedback', { issues: parsed.error.issues.map((i) => i.path.join('.')) });
      const task = state.aiTasks[parsed.data.ai_task_id];
      if (!task) return error(404, 'not_found', 'AI task not found');
      if (task.user_id !== u.id) return error(403, 'forbidden', 'Only the owner of the AI task can rate it', { ai_task_id: parsed.data.ai_task_id });
      const prev = state.feedback[parsed.data.ai_task_id];
      const rec = { id: prev?.id ?? uuid(), user_id: u.id, rating: parsed.data.rating, comment: parsed.data.comment?.trim() ? parsed.data.comment.trim().slice(0, 1000) : null };
      state.feedback[parsed.data.ai_task_id] = rec;
      persist();
      return json(201, { ok: true, id: rec.id, ai_task_id: parsed.data.ai_task_id, rating: rec.rating, updated: !!prev });
    }),
    // Chẩn đoán AI (diagnose_rl, v1.1 S5): SSE như explain; đã có → start{cached:true} → result → done (không trừ credit)
    route('POST', '/attempts/{attemptId}/diagnosis', ({ params, locale }) => {
      const u = requireUser();
      if (u instanceof Response) return u;
      const a = state.attempts[params.attemptId!];
      if (!a || a.user_id !== u.id) return error(404, 'not_found', 'Attempt not found');
      if (!a.result) return error(409, 'conflict', 'Attempt is not graded yet', { status: a.status });
      if (examInProgress(u.id, a.id)) return error(403, 'exam_mode_locked', 'AI is locked during an exam');
      const lang = u.explain_locale ?? locale;
      if (a.ai_diagnosis && a.ai_diagnosis.locale === lang && a.ai_diagnosis.prompt_version_id === PROMPT_VERSION.diagnose_rl) {
        const dto: AttemptAiDiagnosis = { ...a.ai_diagnosis, attempt_id: a.id, cached: true };
        return sse([{ event: 'start', data: { ai_task_id: dto.ai_task_id ?? '', cached: true } }, { event: 'result', data: { data: dto, ai_task_id: dto.ai_task_id, cached: true } }, { event: 'done', data: {} }]);
      }
      if (!isPro(u)) return error(403, 'forbidden', 'Feature requires an upgrade', { feature: 'ai_diagnose', program: a.program, upgrade: true });
      const balance = state.credits[u.id] ?? 0;
      if (balance < DIAGNOSE_CREDITS) return error(402, 'insufficient_credits', 'Not enough credits', { required: DIAGNOSE_CREDITS, balance });
      const aiTaskId = recordTask(u.id, 'diagnose_rl');
      const output = buildDiagnosis(a, lang);
      const fail = takeMockAiFailure();
      if (fail) {
        persist();
        return sse([{ event: 'start', data: { ai_task_id: aiTaskId, cached: false } }, ...jsonDeltas(output).slice(0, 3), { event: 'error', data: { code: fail, message: fail }, delayMs: 150 }, { event: 'done', data: {} }]);
      }
      // Lưu kết quả + trừ credit cùng lúc (API: cùng transaction)
      a.ai_diagnosis = { ...output, locale: lang, ai_task_id: aiTaskId, prompt_version_id: PROMPT_VERSION.diagnose_rl, created_at: nowIso() };
      state.credits[u.id] = balance - DIAGNOSE_CREDITS;
      persist();
      const dto: AttemptAiDiagnosis = { ...a.ai_diagnosis, attempt_id: a.id, cached: false };
      return sse([{ event: 'start', data: { ai_task_id: aiTaskId, cached: false } }, ...jsonDeltas(output), { event: 'result', data: { data: dto, ai_task_id: aiTaskId, cached: false }, delayMs: 120 }, { event: 'done', data: {} }]);
    }),
    route('GET', '/attempts/{attemptId}/diagnosis', ({ params }) => {
      const u = requireUser();
      if (u instanceof Response) return u;
      const a = state.attempts[params.attemptId!];
      if (!a || a.user_id !== u.id) return error(404, 'not_found', 'Attempt not found');
      if (!a.ai_diagnosis) return error(404, 'not_found', 'attempt_diagnosis not found');
      return json(200, { ...a.ai_diagnosis, attempt_id: a.id, cached: true } satisfies AttemptAiDiagnosis);
    }),

    // --------------------------------------------------------------------- S10 (trước S9: đè /vocab/lists/{id}/items, /me/errors/drill tạm)
    ...s10.routes,

    // --------------------------------------------------------------------- S9: chẩn đoán, lộ trình, check-in, huy hiệu
    ...learning.routes,

    // --------------------------------------------------------------------- S7/S8: billing, khuyến mãi, admin, referral, thông báo
    // (đặt TRƯỚC learningToolRoutes: GET/PATCH /me/notification-preferences bản S8 có categories đè bản S6)
    ...billingRoutes({ state, persist, route, json, error, uuid, nowIso, requireUser, currentUser, onOrderPaid: (userId) => referral.onOrderPaid(userId) }),
    ...growthRoutes({ state, persist, route, json, error, uuid, nowIso, requireUser, currentUser, onOrderPaid: () => undefined }),

    // --------------------------------------------------------------------- S6: gia sư, tra từ, TTS, SRS, ghi chú, Web Push
    ...learningToolRoutes({
      state,
      persist,
      // Handler S6 không đọc `headers` (S8 thêm vào ctx) – tương thích lúc chạy
      route: route as unknown as Parameters<typeof learningToolRoutes>[0]['route'],
      json,
      error,
      empty,
      sse,
      uuid,
      nowIso,
      requireUser,
      openExamId: (userId) => Object.values(state.attempts).find((a) => a.user_id === userId && a.status === 'in_progress' && a.mode === 'exam')?.id ?? null,
      quotaExceeded,
      consumeQuota,
      refundQuota,
      quotaLimit: (u, feature) => quotaFor(u, feature)?.limit ?? null,
      recordTask,
      findQuestionByVersion: (qv) => allQuestions().find((q) => q.question_version_id === qv),
      takeAiFailure: takeMockAiFailure,
    }),
  ];

  const summarize = (t: MockTestSet, userId: string | null) => {
    const mine = userId ? Object.values(state.attempts).filter((a) => a.user_id === userId && a.test_set_id === t.id && a.result) : [];
    const scores = mine.map((a) => a.result!.scaled_score).filter((s): s is number => s !== null);
    return {
      id: t.id,
      code: t.code,
      title: t.title,
      kind: t.kind,
      level: t.level,
      is_free: t.is_free,
      // Pro mở mọi đề (như entitlement full_test của API)
      locked: t.locked && !(userId && state.users[userId] && isPro(state.users[userId])),
      duration_sec: t.duration_sec,
      question_count: t.question_count,
      last_score: scores.length ? (mine.sort((x, y) => (y.submitted_at ?? '').localeCompare(x.submitted_at ?? ''))[0]?.result?.scaled_score ?? null) : null,
      best_score: scores.length ? Math.max(...scores) : null,
      attempts_count: mine.length,
    };
  };

  // ------------------------------------------------------------------- S11: feature flag công khai + kill-switch
  const mockFlagOn = (key: string) => state.flags[key]?.enabled ?? MOCK_FLAG_DEFAULTS[key] ?? false;
  const flagRoutes: Route[] = [
    // C1: trạng thái chương trình như API – đã ra mắt (cờ ff.catalog.program.*, TOEIC luôn mở) + có đề → available
    route('GET', '/programs', () =>
      json(
        200,
        MOCK_PROGRAMS.map((p, i) => {
          const def = programDef(p.code);
          const sets = p.code === 'toeic' ? MOCK_TEST_SETS.length : p.code === 'ielts' ? MOCK_IELTS_TEST_SETS.length : 0;
          const launched = !def?.launch_flag || mockFlagOn(def.launch_flag);
          return { ...p, status: launched && sets > 0 ? 'available' : 'coming_soon', phase: def?.phase ?? 3, sort_order: i + 1, skills: [...(def?.skills ?? [])], published_test_sets: sets, question_types: [...(def?.question_types ?? [])] };
        }),
      ),
    ),
    route('GET', '/flags', () =>
      json(200, { flags: Object.fromEntries(PUBLIC_FLAG_KEYS.map((k) => [k, mockFlagOn(k)])), ttl_sec: 30, evaluated_at: nowIso() }, { 'Cache-Control': 'private, no-cache' }),
    ),
    route('GET', '/admin/flags', () => {
      const u = currentUser();
      if (!u?.roles.includes('admin')) return error(u ? 403 : 401, u ? 'forbidden' : 'unauthorized', 'Admin only');
      const keys = [...new Set([...PUBLIC_FLAG_KEYS, 'ff.growth.beta_gate', ...Object.keys(state.flags)])].sort();
      return json(200, { data: keys.map((key) => ({ key, enabled: mockFlagOn(key), rules: {}, updated_at: nowIso(), public: (PUBLIC_FLAG_KEYS as readonly string[]).includes(key) })) });
    }),
  ];
  routes.unshift(...flagRoutes);

  const mockFetch: typeof fetch = async (input, init) => {
    // Giả lập mất mạng như fetch thật (Playwright context.setOffline → navigator.onLine = false)
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new TypeError('Failed to fetch');
    // E2E nhiều tab: `window.__ALLINGO_MOCK_SYNC__ = true` → đọc lại trạng thái từ localStorage trước mỗi yêu cầu
    // (như một máy chủ dùng chung – vd. bài thi bắt đầu ở tab khác khoá gia sư ở tab này)
    if (typeof window !== 'undefined' && (window as unknown as { __ALLINGO_MOCK_SYNC__?: unknown }).__ALLINGO_MOCK_SYNC__ === true) Object.assign(state, loadState());
    const req = input instanceof Request ? input : new Request(input, init);
    const url = new URL(req.url);
    const base = new URL(env.apiUrl);
    let path = url.pathname;
    if (path.startsWith(base.pathname)) path = path.slice(base.pathname.length) || '/';
    const method = req.method.toUpperCase();
    const locale = req.headers.get('accept-language')?.slice(0, 2) ?? 'vi';
    let body: unknown = undefined;
    if (method !== 'GET' && method !== 'HEAD') {
      const text = await req.text();
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = text;
        }
      }
    }
    await sleep(LATENCY_MS);
    // S11: kill-switch như `@KillSwitch` của API (sau xác thực, trước rate limit) → 503 feature_disabled + Retry-After
    const killed = killSwitchFor(method, path);
    if (killed && !mockFlagOn(killed)) {
      return json(503, { error: { code: 'feature_disabled', message: 'Feature is disabled', details: { flag: killed, message_key: 'errors.feature_disabled', retry_after_sec: 60 }, trace_id: `mock-${uuid().slice(0, 8)}` } }, { 'Retry-After': '60' });
    }
    // S12: token impersonate (chỉ đọc), tài khoản bị khoá, step-up MFA /admin/*, beta gate – như guard toàn cục của API
    const guarded = s12.guard(method, path, req.headers, body);
    if (guarded instanceof Response) return guarded;
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = r.pattern.exec(path);
      if (!m) continue;
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1] ?? '')));
      if (guarded?.asUser) {
        // Xem như người dùng: chạy handler GET với phiên của người đó rồi trả lại phiên admin
        const prev = state.sessionUserId;
        state.sessionUserId = guarded.asUser;
        try {
          return await r.handler({ url, params, body, method, locale, headers: req.headers });
        } finally {
          state.sessionUserId = prev;
        }
      }
      return r.handler({ url, params, body, method, locale, headers: req.headers });
    }
    return error(404, 'not_found', `No mock route for ${method} ${path}`);
  };
  // E2E: gọi "máy chủ" giả từ trang (`window.__ALLINGO_MOCK__.request('POST', '/promotions/redeem', body)`) như page.request với API thật
  if (typeof window !== 'undefined') {
    const w = window as unknown as { __ALLINGO_MOCK__?: Record<string, unknown> };
    w.__ALLINGO_MOCK__ = {
      ...(w.__ALLINGO_MOCK__ ?? {}),
      // S11 E2E: bật/tắt cờ như admin `PUT /admin/flags/{key}` (không cần phiên admin trong "máy chủ" giả)
      setFlag: (key: string, enabled: boolean) => {
        state.flags[key] = { enabled };
        persist();
      },
      // S12 E2E: mã mời trong "hộp thư giả", bật step-up MFA admin, ép NPS đến hạn, thêm job dead-letter
      ...s12.hooks,
      request: async (method: string, path: string, body?: unknown) => {
        const res = await mockFetch(`${env.apiUrl}${path}`, { method, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': uuid() }, body: body === undefined ? undefined : JSON.stringify(body) });
        const text = await res.text();
        let data: unknown = text;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          /* giữ chuỗi */
        }
        return { status: res.status, data };
      },
    };
  }
  return mockFetch;
}
