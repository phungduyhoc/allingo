import {
  ATTEMPT_GRACE_SECONDS,
  DEFAULT_QUOTAS,
  XP_RULES,
  answerInputSchema,
  attemptEventSchema,
  correctAnswerOf,
  grade,
  isAnswered,
  isSpokenTextSection,
  redactSpokenText,
  timedDrillSeconds,
  toPublicContent,
  type Attempt,
  type AttemptMode,
  type AttemptResult,
  type AttemptReview,
  type AttemptSummary,
  type Entitlements,
  type Explanation,
  type Stats,
  type TranscriptHighlight,
  type User,
} from '@allingo/schemas';
import { SCALE_INFO, TOEIC_PART_SKILL, diagnoseAttempt, toeicLr, toeicLrEstimate } from '@allingo/scoring';
import { env } from '@/env';
import { MOCK_PROGRAMS, MOCK_SUBSKILL_OF_TAG, MOCK_TEST_SETS, type MockQuestion, type MockTestSet } from './fixtures';
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

  const findTestSet = (id: string): MockTestSet | undefined => MOCK_TEST_SETS.find((t) => t.id === id);
  const allQuestions = (): MockQuestion[] => MOCK_TEST_SETS.flatMap((t) => t.questions);
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

  /**
   * Câu công khai như API: URL media "ký" 10′; đang làm bài (`attempt`) → Part 1/2 xoá chữ đề/lựa chọn, passage audio_script
   * không có body (transcript). Review (`review`) trả đủ chữ + body.
   */
  const publicQuestion = (q: MockQuestion, view: 'attempt' | 'review'): Attempt['questions'][number] => {
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
      content,
      media: q.media.map(({ transcript: _t, ...m }) => ({ ...m, ...signUrl(m.url, 'init') })),
      passage,
    };
  };
  /** TranscriptHighlight như API: passage audio_script (Part 3/4) hoặc transcript audio câu (Part 1/2), kèm evidence của tác giả */
  const transcriptOf = (q: MockQuestion): TranscriptHighlight | null => {
    const evidence = q.content.evidence ?? null;
    if (q.passage?.kind === 'audio_script' && q.passage.body) return { text: q.passage.body, ...(q.passage.segments ? { segments: q.passage.segments } : {}), evidence, source: 'passage', asset_id: q.passage.media_asset_id ?? null };
    const audio = q.media.find((m) => m.kind === 'audio');
    if (audio?.transcript) return { text: audio.transcript.text, ...(audio.transcript.segments ? { segments: audio.transcript.segments } : {}), evidence, source: 'media', asset_id: audio.id };
    return evidence ? { text: evidence, evidence, source: 'evidence', asset_id: audio?.id ?? null } : null;
  };

  const toAttemptDto = (a: MockAttemptRecord): Attempt => {
    const ts = findTestSet(a.test_set_id);
    const qs = questionsOf(a);
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
        locked: false,
      })),
      questions: qs.map((q) => publicQuestion(q, 'attempt')),
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
                return [[q.question_id, { is_correct: g.is_correct, correct_answer: correctAnswerOf(q.content), explanation: q.content.explanation ? { ...q.content.explanation } : null, transcript: groupDone ? transcriptOf(q) : null }]];
              }),
            ),
          }
        : {}),
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
      const unique = [...new Map(allQuestions().filter((qq) => qq.section_code === section && (!q || JSON.stringify(qq.content).toLowerCase().includes(q))).map((qq) => [qq.question_id, qq])).values()];
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
        expires_at: timed ? new Date(started + timedDrillSeconds(picked.map((x) => x.section_code), perQuestion) * 1000).toISOString() : null,
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
      for (const q of questionsOf(a)) {
        for (const m of q.media) seen.set(m.id, { id: m.id, kind: m.kind, ...signUrl(m.url, sig) });
        if (q.passage?.media_asset_id && q.passage.media_url) seen.set(q.passage.media_asset_id, { id: q.passage.media_asset_id, kind: 'audio', ...signUrl(q.passage.media_url, sig) });
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
      for (const q of questionsOf(a)) {
        const rec = a.answers[q.question_id];
        const g = grade(q.content, rec?.answer ?? null);
        if (onlyWrong && g.is_correct !== false) continue;
        if (flaggedOnly && !rec?.flagged) continue;
        if (section && q.section_code !== section) continue;
        const chosen = rec?.answer.type === 'mcq_single' ? (rec.answer.selected ?? '') : '';
        const cacheKey = `${q.question_version_id}:${chosen}:${u.explain_locale ?? locale}`;
        items.push({
          question: publicQuestion(q, 'review'),
          your_answer: rec?.answer ?? null,
          correct_answer: g.correct_answer,
          is_correct: g.is_correct,
          score: g.score,
          time_spent_ms: rec?.time_spent_ms ?? null,
          flagged: rec?.flagged ?? false,
          details: g.details ?? null,
          explanation: state.explanations[cacheKey] ? (state.explanations[cacheKey]) : null,
          transcript_highlight: transcriptOf(q),
          audio_plays: a.audio_plays?.[q.question_id] ?? 0,
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
    // Giả lập mất mạng như fetch thật (Playwright context.setOffline → navigator.onLine = false)
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new TypeError('Failed to fetch');
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
