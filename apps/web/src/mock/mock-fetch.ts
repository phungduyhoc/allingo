import {
  DEFAULT_QUOTAS,
  XP_RULES,
  answerInputSchema,
  correctAnswerOf,
  grade,
  isAnswered,
  toPublicContent,
  type Attempt,
  type AttemptMode,
  type AttemptResult,
  type AttemptReview,
  type AttemptSummary,
  type Entitlements,
  type Explanation,
  type Stats,
  type User,
} from '@allingo/schemas';
import { SCALE_INFO, TOEIC_PART_SKILL, toeicLr } from '@allingo/scoring';
import { env } from '@/env';
import { MOCK_PROGRAMS, MOCK_TEST_SETS, type MockQuestion, type MockTestSet } from './fixtures';
import { loadState, saveState, type MockAttemptRecord, type MockState, type MockUserRecord } from './state';

/**
 * fetch giả lập cho dev/e2e khi NEXT_PUBLIC_API_MOCK=1. Bám hợp đồng docs/spec/allingo-openapi.yaml + Zod
 * trong packages/schemas (envelope lỗi, cookie-mode, SSE cho /ai/explain, submit idempotent, quota Free).
 * Không dùng ở production; không chứa logic nghiệp vụ "thật".
 */

const LATENCY_MS = 120;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const today = () => new Date().toISOString().slice(0, 10);
const nowIso = () => new Date().toISOString();
const uuid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const empty = (status: number) => new Response(null, { status });
const error = (status: number, code: string, message: string, details?: Record<string, unknown>) =>
  json(status, { error: { code, message, details, trace_id: `mock-${uuid().slice(0, 8)}` } });

type Handler = (ctx: { url: URL; params: Record<string, string>; body: unknown; method: string; locale: string }) => Promise<Response> | Response;
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
  const { password: _p, guest_token: _g, ...rest } = u;
  return rest;
}

function freeLimit(feature: string): number | null {
  const q = DEFAULT_QUOTAS.find((x) => x.plan_kind === 'free' && x.feature === feature);
  return q ? q.limit : null;
}

export function createMockFetch(): typeof fetch {
  const state: MockState = loadState();
  const persist = () => saveState(state);

  const findTestSet = (id: string): MockTestSet | undefined => MOCK_TEST_SETS.find((t) => t.id === id);
  const questionsOf = (a: MockAttemptRecord): MockQuestion[] => findTestSet(a.test_set_id)?.questions ?? [];

  const currentUser = (): MockUserRecord | null => (state.sessionUserId ? (state.users[state.sessionUserId] ?? null) : null);
  const requireUser = (): MockUserRecord | Response => currentUser() ?? error(401, 'unauthorized', 'Session expired');

  const usageOf = (userId: string, feature: string): number => state.usage[userId]?.[feature]?.[today()] ?? 0;
  const bumpUsage = (userId: string, feature: string) => {
    const u = (state.usage[userId] ??= {});
    const f = (u[feature] ??= {});
    f[today()] = (f[today()] ?? 0) + 1;
  };

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

  const toAttemptDto = (a: MockAttemptRecord): Attempt => {
    const ts = findTestSet(a.test_set_id);
    const qs = questionsOf(a);
    return {
      id: a.id,
      program: a.program as Attempt['program'],
      mode: a.mode,
      status: a.status,
      test_set: ts ? { id: ts.id, code: ts.code, title: ts.title, kind: ts.kind, question_count: ts.question_count, duration_sec: ts.duration_sec } : null,
      sections: (ts?.sections ?? []).map((s) => ({
        section_code: s.code,
        duration_sec: a.mode === 'practice' ? null : s.duration_sec,
        elapsed_sec: a.section_elapsed_sec[s.code] ?? 0,
        locked: false,
      })),
      questions: qs.map((q) => ({
        question_id: q.question_id,
        question_version_id: q.question_version_id,
        question_type: q.content.type,
        section_code: q.section_code,
        group_key: q.group_key,
        order_no: q.order_no,
        content: toPublicContent(q.content),
        media: q.media,
        passage: q.passage,
      })),
      draft_answers: Object.entries(a.answers).map(([question_id, r]) => ({ question_id, answer: r.answer, time_spent_ms: r.time_spent_ms, flagged: r.flagged })),
      started_at: a.started_at,
      expires_at: a.expires_at,
      server_time: nowIso(),
      ui_state: a.ui_state,
    };
  };

  const gradeAttempt = (a: MockAttemptRecord): AttemptResult => {
    const qs = questionsOf(a);
    const bySection: AttemptResult['by_section'] = {};
    const byType: AttemptResult['by_question_type'] = {};
    const bySubskill: AttemptResult['by_subskill'] = {};
    let correct = 0;
    let unanswered = 0;
    for (const q of qs) {
      const rec = a.answers[q.question_id];
      const g = grade(q.content, rec?.answer ?? null);
      if (!rec || !isAnswered(rec.answer)) unanswered++;
      const ok = g.is_correct === true;
      if (ok) correct++;
      const sec = (bySection[q.section_code] ??= { correct: 0, total: 0, avg_time_ms: null, score: null });
      sec.total++;
      if (ok) sec.correct++;
      const t = (byType[q.content.type] ??= { correct: 0, total: 0 });
      t.total++;
      if (ok) t.correct++;
      for (const tag of q.content.tags ?? []) {
        const s = (bySubskill[tag] ??= { correct: 0, total: 0 });
        s.total++;
        if (ok) s.correct++;
      }
    }
    const listening = { correct: 0, total: 0 };
    const reading = { correct: 0, total: 0 };
    for (const [code, s] of Object.entries(bySection)) {
      const skill = TOEIC_PART_SKILL[code];
      if (skill === 'listening') {
        listening.correct += s.correct;
        listening.total += s.total;
      } else if (skill === 'reading') {
        reading.correct += s.correct;
        reading.total += s.total;
      }
    }
    const lr = toeicLr({ listening: listening.total ? listening : undefined, reading: reading.total ? reading : undefined });
    const scaled = lr.total ?? lr.listening ?? lr.reading;
    const previous = Object.values(state.attempts)
      .filter((x) => x.user_id === a.user_id && x.id !== a.id && x.result && x.test_set_id === a.test_set_id)
      .sort((x, y) => (y.submitted_at ?? '').localeCompare(x.submitted_at ?? ''))[0];
    const xp = XP_RULES.attempt_submitted + correct * XP_RULES.question_correct;
    state.xp[a.user_id] = (state.xp[a.user_id] ?? 0) + xp;
    return {
      attempt_id: a.id,
      raw_score: correct,
      scaled_score: scaled,
      scale: { ...SCALE_INFO.toeic, skills: { listening: lr.listening, reading: lr.reading }, ci: lr.ci, total_questions: qs.length, unanswered },
      by_section: bySection,
      by_question_type: byType,
      by_subskill: bySubskill,
      compared_to_previous:
        previous && previous.result
          ? { scaled_delta: scaled !== null && previous.result.scaled_score !== null ? scaled - previous.result.scaled_score : null, previous_attempt_id: previous.id }
          : null,
      diagnosis: null,
      xp_earned: xp,
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

  const routes: Route[] = [
    // --------------------------------------------------------------------- auth
    route('POST', '/auth/guest', () => {
      const user = makeUser({ is_guest: true, guest_token: `guest_${uuid()}` });
      state.users[user.id] = user;
      state.sessionUserId = user.id;
      persist();
      const expires_at = new Date(Date.now() + 30 * 86_400_000).toISOString();
      return json(201, { guest_token: user.guest_token, expires_at, user: publicUser(user), access_token: 'mock-access', expires_in: 900 });
    }),
    route('POST', '/auth/register', ({ body }) => {
      const b = body as { email?: string; password?: string; display_name?: string; guest_token?: string; ui_locale?: string };
      if (!b.email || !b.password || !b.display_name) return error(400, 'validation_failed', 'Missing fields', { fields: { email: 'required' } });
      if (Object.values(state.users).some((u) => u.email?.toLowerCase() === b.email!.toLowerCase())) return error(409, 'conflict', 'Email already registered');
      const guest = b.guest_token ? Object.values(state.users).find((u) => u.guest_token === b.guest_token) : undefined;
      const user = makeUser({
        is_guest: false,
        email: b.email,
        password: b.password,
        display_name: b.display_name,
        ui_locale: (b.ui_locale as User['ui_locale']) ?? 'vi',
      });
      state.users[user.id] = user;
      if (guest) {
        // Ghép tiến độ khách → tài khoản mới
        for (const a of Object.values(state.attempts)) if (a.user_id === guest.id) a.user_id = user.id;
        state.xp[user.id] = (state.xp[user.id] ?? 0) + (state.xp[guest.id] ?? 0);
        state.enrollments[user.id] = state.enrollments[guest.id] ?? [];
        delete state.users[guest.id];
      }
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
    route('POST', '/auth/otp/verify', ({ body }) => {
      const b = body as { email?: string; otp?: string; display_name?: string; guest_token?: string };
      if (b.otp !== '123456') return error(401, 'unauthorized', 'Invalid OTP', { reason: 'otp_invalid', attempts_left: 4 });
      let user = Object.values(state.users).find((u) => u.email?.toLowerCase() === b.email?.toLowerCase());
      if (!user) {
        user = makeUser({ is_guest: false, email: b.email ?? null, display_name: b.display_name ?? (b.email ?? 'user').split('@')[0]! });
        state.users[user.id] = user;
      }
      const guest = b.guest_token ? Object.values(state.users).find((u) => u.guest_token === b.guest_token && u.id !== user.id) : undefined;
      if (guest) {
        for (const a of Object.values(state.attempts)) if (a.user_id === guest.id) a.user_id = user.id;
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
      const days = new Set(graded.map((a) => (a.submitted_at ?? '').slice(0, 10)));
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
        streak: { current: days.has(today()) ? Math.max(1, days.size) : 0, longest: days.size, freeze_available: false },
        xp: { total: state.xp[u.id] ?? 0, this_week: state.xp[u.id] ?? 0 },
        minutes_this_week: graded.length * 8,
      };
      return json(200, stats);
    }),
    route('GET', '/me/entitlements', ({ url }) => {
      const u = requireUser();
      if (u instanceof Response) return u;
      const program = url.searchParams.get('program') ?? 'toeic';
      const reset = new Date();
      reset.setHours(24, 0, 0, 0);
      const ent: Entitlements = {
        program,
        is_pro: false,
        features: ['mini_test', 'part_drill', 'ai_explain', 'ai_tutor', 'dictionary_ai'],
        quotas: DEFAULT_QUOTAS.filter((q) => q.plan_kind === 'free').map((q) => ({ feature: q.feature, period: q.period, limit: q.limit, used: usageOf(u.id, q.feature), reset_at: reset.toISOString() })),
        credits: 0,
      };
      return json(200, ent);
    }),
    route('GET', '/me/attempts', ({ url }) => {
      const u = requireUser();
      if (u instanceof Response) return u;
      const program = url.searchParams.get('program');
      const data: AttemptSummary[] = Object.values(state.attempts)
        .filter((a) => a.user_id === u.id && (!program || a.program === program))
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
      return u instanceof Response ? u : json(200, state.enrollments[u.id] ?? []);
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
    route('GET', '/programs', () => json(200, MOCK_PROGRAMS)),
    route('GET', '/programs/{program}/test-sets', ({ params, url }) => {
      const u = currentUser();
      const kind = url.searchParams.get('kind');
      if (params.program !== 'toeic') return json(200, { data: [], next_cursor: null });
      const data = MOCK_TEST_SETS.filter((t) => !kind || t.kind === kind).map((t) => summarize(t, u?.id ?? null));
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
    route('POST', '/attempts', ({ body }) => {
      const u = requireUser();
      if (u instanceof Response) return u;
      const b = body as { program: string; mode: AttemptMode; test_set_id?: string };
      const t = b.test_set_id ? findTestSet(b.test_set_id) : undefined;
      if (!t) return error(404, 'not_found', 'Test set not found');
      if (t.locked) return error(403, 'forbidden', 'Pro plan required', { feature: 'full_test' });
      const feature = t.kind === 'full' ? 'full_test' : t.kind === 'part_drill' ? 'part_drill' : 'mini_test';
      const limit = freeLimit(feature);
      if (limit !== null && usageOf(u.id, feature) >= limit) return error(429, 'quota_exceeded', 'Daily quota reached', { feature, limit });
      const existing = Object.values(state.attempts).find((a) => a.user_id === u.id && a.test_set_id === t.id && a.status === 'in_progress');
      if (existing) return json(201, toAttemptDto(existing));
      bumpUsage(u.id, feature);
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
      const b = body as { answers?: { question_id: string; answer: unknown; time_spent_ms?: number; flagged?: boolean }[]; section_elapsed_sec?: Record<string, number>; ui_state?: Record<string, unknown> };
      for (const ans of b.answers ?? []) {
        const parsed = answerInputSchema.safeParse(ans.answer);
        if (!parsed.success) return error(400, 'validation_failed', 'Invalid answer', { question_id: ans.question_id });
        const prev = a.answers[ans.question_id];
        a.answers[ans.question_id] = { answer: parsed.data, time_spent_ms: ans.time_spent_ms ?? prev?.time_spent_ms, flagged: ans.flagged ?? prev?.flagged };
      }
      if (b.section_elapsed_sec) Object.assign(a.section_elapsed_sec, b.section_elapsed_sec);
      if (b.ui_state) a.ui_state = { ...a.ui_state, ...b.ui_state };
      persist();
      return empty(204);
    }),
    route('POST', '/attempts/{attemptId}/events', ({ params, body }) => {
      const a = state.attempts[params.attemptId!];
      if (a) {
        const b = body as { type?: string; at?: string };
        a.events.push({ type: b.type ?? 'unknown', at: b.at ?? nowIso() });
        if (a.events.length > 200) a.events.shift();
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
    route('GET', '/attempts/{attemptId}/review', ({ params, url, locale }) => {
      const u = requireUser();
      if (u instanceof Response) return u;
      const a = state.attempts[params.attemptId!];
      if (!a || a.user_id !== u.id) return error(404, 'not_found', 'Attempt not found');
      if (!a.result) return error(409, 'conflict', 'Attempt not submitted yet');
      const onlyWrong = url.searchParams.get('only_wrong') === 'true';
      const items: AttemptReview['items'] = [];
      for (const q of questionsOf(a)) {
        const rec = a.answers[q.question_id];
        const g = grade(q.content, rec?.answer ?? null);
        if (onlyWrong && g.is_correct === true) continue;
        const chosen = rec?.answer.type === 'mcq_single' ? (rec.answer.selected ?? '') : '';
        const cacheKey = `${q.question_version_id}:${chosen}:${u.explain_locale ?? locale}`;
        items.push({
          question: {
            question_id: q.question_id,
            question_version_id: q.question_version_id,
            question_type: q.content.type,
            section_code: q.section_code,
            group_key: q.group_key,
            order_no: q.order_no,
            content: toPublicContent(q.content),
            media: q.media,
            passage: q.passage,
          },
          your_answer: rec?.answer ?? null,
          correct_answer: g.correct_answer,
          is_correct: g.is_correct,
          score: g.score,
          time_spent_ms: rec?.time_spent_ms ?? null,
          flagged: rec?.flagged ?? false,
          details: g.details ?? null,
          explanation: state.explanations[cacheKey] ? (state.explanations[cacheKey]) : null,
          transcript_highlight: null,
          error_entry_id: null,
          community_correct_rate: q.community_correct_rate,
        });
      }
      return json(200, { attempt_id: a.id, items });
    }),

    // --------------------------------------------------------------------- ai
    route('POST', '/ai/explain', async ({ body, locale }) => {
      const u = requireUser();
      if (u instanceof Response) return u;
      const b = body as { question_version_id: string; chosen_option?: string; attempt_id?: string };
      const q = MOCK_TEST_SETS.flatMap((t) => t.questions).find((x) => x.question_version_id === b.question_version_id);
      if (!q) return error(404, 'not_found', 'Question version not found');
      // Exam Mode: đang có bài thi chưa nộp → 403 (CLAUDE.md §5.8)
      const examInProgress = Object.values(state.attempts).some((a) => a.user_id === u.id && a.status === 'in_progress' && a.mode === 'exam');
      if (examInProgress) return error(403, 'exam_mode_locked', 'Explanations are locked during an exam');
      const lang = u.explain_locale ?? locale;
      const cacheKey = `${b.question_version_id}:${b.chosen_option ?? ''}:${lang}`;
      const cached = state.explanations[cacheKey];
      if (cached) return json(200, { ...cached, cached: true });
      const limit = freeLimit('ai_explain');
      if (limit !== null && usageOf(u.id, 'ai_explain') >= limit) return error(429, 'quota_exceeded', 'Daily explanation quota reached', { feature: 'ai_explain', limit });
      bumpUsage(u.id, 'ai_explain');
      const aiTaskId = uuid();
      const explanation = buildExplanation(q, b.chosen_option, lang, aiTaskId, false);
      state.explanations[cacheKey] = { ...explanation, cached: true };
      persist();
      const words = explanation.why_correct.split(' ');
      const deltas = [] as { event: string; data: unknown; delayMs?: number }[];
      for (let i = 0; i < words.length; i += 3) deltas.push({ event: 'delta', data: { text: words.slice(i, i + 3).join(' ') + ' ' }, delayMs: 90 });
      return sse([{ event: 'start', data: { ai_task_id: aiTaskId, cached: false } }, ...deltas, { event: 'result', data: { data: explanation, ai_task_id: aiTaskId, cached: false }, delayMs: 150 }, { event: 'done', data: {} }]);
    }),
    route('POST', '/ai/feedback', () => empty(201)),
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
      locked: t.locked,
      duration_sec: t.duration_sec,
      question_count: t.question_count,
      last_score: scores.length ? (mine.sort((x, y) => (y.submitted_at ?? '').localeCompare(x.submitted_at ?? ''))[0]?.result?.scaled_score ?? null) : null,
      best_score: scores.length ? Math.max(...scores) : null,
      attempts_count: mine.length,
    };
  };

  return async (input, init) => {
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
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = r.pattern.exec(path);
      if (!m) continue;
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1] ?? '')));
      return r.handler({ url, params, body, method, locale });
    }
    return error(404, 'not_found', `No mock route for ${method} ${path}`);
  };
}
