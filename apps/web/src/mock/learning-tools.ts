import { TUTOR_MESSAGE_MAX_CHARS, type TutorCitation, type TutorReply } from '@allingo/schemas/api/core';
import { NOTE_BODY_MAX, lookupWordCount, normalizeLookupTerm, notificationPreferencesPatchSchema, pushSubscriptionInputSchema, sanitizeNoteMarkdown, srsCardCreateSchema, type DictionaryEntry, type Note, type NotificationPreferences } from '@allingo/schemas/api/learning-tools';
import { correctAnswerOf } from '@allingo/schemas/question/grade';
import type { MockQuestion } from './fixtures';
import { MOCK_DICTIONARY, trigramSimilarity, type MockDictEntry } from './dictionary';
import type { MockMessageRecord, MockState, MockThreadRecord, MockUserRecord } from './state';

/**
 * Route giả lập Sprint 6 (gia sư SSE, tra từ + TTS, SRS, ghi chú, Web Push) bám hợp đồng OpenAPI v1.1/Zod.
 * Exam Mode: attempt exam `in_progress` → 403 `exam_mode_locked` cho /ai/threads*, /dictionary/lookup, ghi /notes.
 * Kịch bản: tin nhắn chứa "ignore previous instructions" (hoặc "bỏ qua mọi hướng dẫn") → guard từ chối `injection`.
 */

type Handler = (ctx: {
  url: URL;
  params: Record<string, string>;
  body: unknown;
  method: string;
  locale: string;
}) => Promise<Response> | Response;
export interface MockRoute {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

export interface LearningToolsDeps {
  state: MockState;
  persist: () => void;
  route: (method: string, path: string, handler: Handler) => MockRoute;
  json: (status: number, body: unknown, headers?: Record<string, string>) => Response;
  error: (status: number, code: string, message: string, details?: Record<string, unknown>) => Response;
  empty: (status: number) => Response;
  sse: (events: { event: string; data: unknown; delayMs?: number }[]) => Response;
  uuid: () => string;
  nowIso: () => string;
  requireUser: () => MockUserRecord | Response;
  /** id attempt exam đang làm (hoặc null) */
  openExamId: (userId: string) => string | null;
  quotaExceeded: (u: MockUserRecord, feature: string) => Response | null;
  consumeQuota: (u: MockUserRecord, feature: string) => void;
  refundQuota: (u: MockUserRecord, feature: string) => void;
  quotaLimit: (u: MockUserRecord, feature: string) => number | null;
  recordTask: (userId: string, task: string) => string;
  findQuestionByVersion: (questionVersionId: string) => MockQuestion | undefined;
  takeAiFailure: () => 'ai_failed' | 'ai_timeout' | null;
}

/** Khoá VAPID công khai giả lập (điểm P-256 hợp lệ để pushManager.subscribe chấp nhận; không có khoá bí mật) */
export const MOCK_VAPID_PUBLIC_KEY =
  'BLPAaqWp0X3nGv9rDk9TlK8mmpHEFWmhi2fAmmzQsMyMpLUbCFGPUc75v4mxEN1XGKXJ8XB3mCY67mHzdlhmLdg';
const DEFAULT_PREFS: NotificationPreferences = {
  channels: { email: true, push: true, zalo: false, inapp: true },
  quiet_hours: { start: '22:00', end: '07:00' },
  reminder_times: ['20:00'],
};
const INJECTION =
  /ignore (all |any )?(previous|prior|above) (instructions|prompts?)|disregard (the )?(system|previous)|bỏ qua (mọi |tất cả )?(hướng dẫn|chỉ dẫn)|system prompt/i;
const TTS_MOCK_AUDIO = ['/demo-audio/p2-01.wav', '/demo-audio/p2-02.wav', '/demo-audio/p2-03.wav'];
const ATTRIBUTION = 'Allingo mock dictionary · nội dung tự biên soạn';

const enc = (n: number) => (typeof btoa === 'function' ? btoa(String(n)) : String(n));
const dec = (c: string | null) => {
  if (!c) return 0;
  try {
    const n = Number(typeof atob === 'function' ? atob(c) : c);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
};

export function learningToolRoutes(d: LearningToolsDeps): MockRoute[] {
  const { state, persist, route, json, error, empty, sse, uuid, nowIso } = d;
  const locked = (u: MockUserRecord) => {
    const id = d.openExamId(u.id);
    return id ? error(403, 'exam_mode_locked', 'Locked during an exam', { attempt_id: id }) : null;
  };

  // ------------------------------------------------------------------- gia sư
  const turnsOf = (u: MockUserRecord, th: MockThreadRecord) => {
    const limit = d.quotaLimit(u, 'ai_tutor_thread_turns');
    return { used: th.turns_used, limit, remaining: limit === null ? null : Math.max(0, limit - th.turns_used) };
  };
  const threadDto = (u: MockUserRecord, th: MockThreadRecord) => ({
    id: th.id,
    program: th.program,
    title: th.title,
    context: th.context,
    updated_at: th.updated_at,
    created_at: th.created_at,
    turns: turnsOf(u, th),
  });
  const messageDto = (m: MockMessageRecord) => ({
    id: m.id,
    role: m.role,
    text: m.text,
    audio_url: null,
    actions: [],
    ai_task_id: m.ai_task_id,
    created_at: m.created_at,
    ...(m.role === 'assistant'
      ? {
          refused: !!m.refused,
          refusal_code: m.refusal_code ?? null,
          suggested_followups: m.suggested_followups ?? [],
          citations: m.citations ?? [],
        }
      : {}),
  });
  const ownThread = (u: MockUserRecord, id: string): MockThreadRecord | Response => {
    const th = state.threads[id];
    if (!th) return error(404, 'not_found', 'Thread not found');
    if (th.user_id !== u.id) return error(403, 'forbidden', 'Not your thread');
    return th;
  };

  const stemOf = (q: MockQuestion) =>
    'stem' in q.content && typeof q.content.stem === 'string' ? q.content.stem.replace(/\s+/g, ' ').trim() : '';

  /** Câu trả lời mẫu (tự biên soạn) bám câu đang xem: đáp án đúng + giải thích tác giả + lý do phương án được hỏi sai */
  const composeReply = (
    th: MockThreadRecord,
    text: string,
    lang: string,
  ): { markdown: string; citations: TutorCitation[]; followups: string[] } => {
    const vi = lang !== 'en';
    const q = th.context.question_version_id ? d.findQuestionByVersion(th.context.question_version_id) : undefined;
    if (q) {
      const correct = correctAnswerOf(q.content);
      const correctKey =
        typeof correct === 'string' ? correct : q.content.type === 'mcq_single' ? q.content.answer_key.correct : '';
      const asked = /\b([A-D])\b/.exec(text.toUpperCase().replace(/ĐÁP ÁN|PHƯƠNG ÁN|OPTION|ANSWER/g, ' '))?.[1];
      const opts = q.content.type === 'mcq_single' ? q.content.options : [];
      const optText = (k: string) => opts.find((o) => o.key === k)?.text ?? k;
      const exp = q.content.explanation
        ? vi
          ? (q.content.explanation.vi ?? q.content.explanation.en)
          : (q.content.explanation.en ?? q.content.explanation.vi)
        : null;
      const stem = stemOf(q);
      const lines = vi
        ? [
            `Xét câu bạn đang xem: *"${stem.slice(0, 120)}"*.`,
            '',
            `- Đáp án đúng là **${correctKey}** ("${optText(correctKey)}")${exp ? `: ${exp}` : '.'}`,
            ...(asked && asked !== correctKey
              ? [
                  `- Phương án **${asked}** ("${optText(asked)}") sai vì không khớp dấu hiệu ngữ pháp/ngữ cảnh quanh chỗ trống.`,
                ]
              : []),
            '',
            '**Mẹo:** gạch chân từ ngay trước và sau chỗ trống, xác định từ loại cần điền rồi mới đọc lựa chọn.',
          ]
        : [
            `Looking at the question you are viewing: *"${stem.slice(0, 120)}"*.`,
            '',
            `- The answer is **${correctKey}** ("${optText(correctKey)}")${exp ? `: ${exp}` : '.'}`,
            ...(asked && asked !== correctKey
              ? [
                  `- Option **${asked}** ("${optText(asked)}") is wrong because it does not fit the grammar or context around the blank.`,
                ]
              : []),
            '',
            '**Tip:** underline the words right before and after the blank and decide the part of speech before reading the options.',
          ];
      return {
        markdown: lines.join('\n'),
        citations: [
          {
            type: 'question',
            question_version_id: q.question_version_id,
            section_code: q.section_code,
            excerpt: stem.slice(0, 160),
          },
        ],
        followups: vi
          ? ['Cho tôi một ví dụ tương tự', 'Làm sao nhận ra dạng câu này nhanh hơn?']
          : ['Give me a similar example', 'How can I spot this type faster?'],
      };
    }
    const markdown = vi
      ? [
          `Câu hỏi của bạn: "${text.slice(0, 120)}".`,
          '',
          'Gợi ý từ gia sư (mô phỏng):',
          '- Xác định **dấu hiệu** trong câu (thời gian, từ loại, cụm cố định).',
          '- Ôn 10 phút mỗi ngày với bộ thẻ từ vựng của bạn.',
          '- Làm thêm một đề mini Part 5 để kiểm tra lại.',
        ].join('\n')
      : [
          `Your question: "${text.slice(0, 120)}".`,
          '',
          'Tutor tips (simulated):',
          '- Find the **cue** in the sentence (time markers, part of speech, fixed phrases).',
          '- Review your vocabulary cards for 10 minutes a day.',
          '- Try another Part 5 mini test to check yourself.',
        ].join('\n');
    return {
      markdown,
      citations: [],
      followups: vi
        ? ['Cho tôi bài tập ngắn', 'Giải thích kỹ hơn']
        : ['Give me a short exercise', 'Explain in more detail'],
    };
  };

  const chunks = (text: string, size = 14) => {
    const out: string[] = [];
    for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
    return out;
  };

  // ------------------------------------------------------------------- tra từ
  const findEntry = (norm: string): { e: MockDictEntry; matched: 'headword' | 'form' } | null => {
    for (const e of MOCK_DICTIONARY) if (e.headword === norm) return { e, matched: 'headword' };
    for (const e of MOCK_DICTIONARY) if (e.forms.includes(norm)) return { e, matched: 'form' };
    return null;
  };
  const savedCard = (userId: string, ref: string) => state.srsCards[`${userId}|${ref}`] ?? null;
  const signedTts = (text: string, voice: string) => {
    const key = `${voice}|${text.toLowerCase()}`;
    const cached = !!state.tts[key];
    if (!cached) {
      let h = 0;
      for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      state.tts[key] = TTS_MOCK_AUDIO[h % TTS_MOCK_AUDIO.length]!;
    }
    const exp = Date.now() + 10 * 60_000;
    return {
      url: `${state.tts[key]}?tts=${encodeURIComponent(key)}&exp=${Math.floor(exp / 1000)}`,
      expires_at: new Date(exp).toISOString(),
      cached,
    };
  };
  const entryDto = (
    u: MockUserRecord,
    query: string,
    e: MockDictEntry,
    matched: 'headword' | 'form',
    lang: string,
  ): DictionaryEntry => {
    const card = savedCard(u.id, e.id);
    const audio = e.audio ? signedTts(e.headword, 'en-US-neural-f') : null;
    const local = (m: MockDictEntry['meanings'][number]) => (lang === 'en' ? m.en : m.vi);
    return {
      query,
      headword: e.headword,
      pos: e.pos,
      ipa: e.ipa_us,
      ipa_us: e.ipa_us,
      ipa_uk: e.ipa_uk,
      audio_url: audio?.url ?? null,
      audio_expires_at: audio?.expires_at ?? null,
      meaning_en: e.meanings[0]?.en ?? null,
      meaning_local: e.meanings[0] ? local(e.meanings[0]) : null,
      example: e.examples[0]?.en ?? null,
      meanings: e.meanings.map((m) => ({ en: m.en, local: local(m), pos: m.pos ?? e.pos })),
      examples: e.examples.map((x) => ({ text: x.en, translation: lang === 'en' ? null : x.vi })),
      collocations: e.collocations,
      forms: e.forms,
      level: e.level,
      topics: e.topics,
      vocab_item_id: e.id,
      saved: !!card,
      srs_card_id: card?.id ?? null,
      source: 'dictionary',
      matched,
      translation: null,
      cached: false,
      suggestions: [],
      locale: lang,
      attribution: ATTRIBUTION,
    };
  };
  const emptyEntry = (u: MockUserRecord, query: string, lang: string): DictionaryEntry => {
    const card = savedCard(u.id, `hw:${normalizeLookupTerm(query)}`);
    return {
      query,
      headword: query,
      pos: null,
      ipa: null,
      ipa_us: null,
      ipa_uk: null,
      audio_url: null,
      audio_expires_at: null,
      meaning_en: null,
      meaning_local: null,
      example: null,
      meanings: [],
      examples: [],
      collocations: [],
      forms: [],
      level: null,
      topics: [],
      vocab_item_id: null,
      saved: !!card,
      srs_card_id: card?.id ?? null,
      source: 'none',
      matched: 'none',
      translation: null,
      cached: false,
      suggestions: [],
      locale: lang,
      attribution: null,
    };
  };
  /** "Bản dịch" mô phỏng (không có model thật) – đánh dấu rõ là mô phỏng */
  const mockTranslate = (term: string, lang: string) =>
    lang === 'en' ? `(simulated AI translation) ${term}` : `(AI dịch mô phỏng) ${term}`;

  // ------------------------------------------------------------------- ghi chú
  const noteDto = (n: Note & { user_id: string }): Note => {
    const { user_id: _u, ...rest } = n;
    return rest;
  };
  const cleanBody = (raw: unknown): string | Response => {
    if (typeof raw !== 'string')
      return error(400, 'validation_failed', 'body is required', { fields: { body: 'required' } });
    const body = sanitizeNoteMarkdown(raw);
    if (!body) return error(400, 'validation_failed', 'Note is empty', { fields: { body: 'empty' } });
    if (body.length > NOTE_BODY_MAX)
      return error(400, 'validation_failed', `Note exceeds ${NOTE_BODY_MAX} characters`, {
        fields: { body: 'too_long' },
      });
    return body;
  };

  return [
    // ----------------------------------------------------------------- /ai/threads
    route('POST', '/ai/threads', ({ body }) => {
      const u = d.requireUser();
      if (u instanceof Response) return u;
      const lk = locked(u);
      if (lk) return lk;
      const b = (body ?? {}) as {
        program?: string;
        title?: string;
        context?: { attempt_id?: string; question_version_id?: string; kind?: string };
      };
      const c = b.context ?? {};
      let context: MockThreadRecord['context'] = { kind: 'free', mode: 'text' };
      if (c.kind !== 'free' && (c.attempt_id || c.question_version_id)) {
        if (c.attempt_id) {
          const a = state.attempts[c.attempt_id];
          if (!a) return error(404, 'not_found', 'Attempt not found');
          if (a.user_id !== u.id) return error(403, 'forbidden', 'Not your attempt');
        }
        if (c.question_version_id && !d.findQuestionByVersion(c.question_version_id))
          return error(404, 'not_found', 'Question version not found');
        context = {
          kind: c.question_version_id ? 'question' : 'attempt',
          ...(c.attempt_id ? { attempt_id: c.attempt_id } : {}),
          ...(c.question_version_id ? { question_version_id: c.question_version_id } : {}),
          mode: 'text',
        };
      }
      const now = nowIso();
      const th: MockThreadRecord = {
        id: uuid(),
        user_id: u.id,
        program: b.program ?? 'toeic',
        title: b.title?.trim().slice(0, 120) || null,
        context,
        created_at: now,
        updated_at: now,
        turns_used: 0,
        messages: [],
      };
      state.threads[th.id] = th;
      persist();
      return json(201, threadDto(u, th));
    }),
    route('GET', '/ai/threads', ({ url }) => {
      const u = d.requireUser();
      if (u instanceof Response) return u;
      const lk = locked(u);
      if (lk) return lk;
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 20));
      const offset = dec(url.searchParams.get('cursor'));
      const all = Object.values(state.threads)
        .filter((t) => t.user_id === u.id)
        .sort((x, y) => y.updated_at.localeCompare(x.updated_at));
      const page = all.slice(offset, offset + limit);
      return json(200, {
        data: page.map((t) => threadDto(u, t)),
        next_cursor: offset + limit < all.length ? enc(offset + limit) : null,
      });
    }),
    route('GET', '/ai/threads/{threadId}', ({ params, url }) => {
      const u = d.requireUser();
      if (u instanceof Response) return u;
      const lk = locked(u);
      if (lk) return lk;
      const th = ownThread(u, params.threadId!);
      if (th instanceof Response) return th;
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));
      const start = Math.max(0, th.messages.length - limit);
      return json(200, {
        ...threadDto(u, th),
        messages: th.messages.slice(start).map(messageDto),
        next_cursor: start > 0 ? enc(start) : null,
      });
    }),
    route('GET', '/ai/threads/{threadId}/messages', ({ params, url }) => {
      const u = d.requireUser();
      if (u instanceof Response) return u;
      const lk = locked(u);
      if (lk) return lk;
      const th = ownThread(u, params.threadId!);
      if (th instanceof Response) return th;
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));
      // cursor = chỉ số tin đầu của trang mới hơn → trang này là các tin trước đó
      const end = url.searchParams.get('cursor') ? dec(url.searchParams.get('cursor')) : th.messages.length;
      const start = Math.max(0, end - limit);
      return json(200, {
        data: th.messages.slice(start, end).map(messageDto),
        next_cursor: start > 0 ? enc(start) : null,
      });
    }),
    route('POST', '/ai/threads/{threadId}/messages', ({ params, body, locale }) => {
      const u = d.requireUser();
      if (u instanceof Response) return u;
      // Thứ tự như API: Exam Mode → lượt/thread → guard → quota ngày → stream
      const lk = locked(u);
      if (lk) return lk;
      const th = ownThread(u, params.threadId!);
      if (th instanceof Response) return th;
      const text = typeof (body as { text?: unknown })?.text === 'string' ? (body as { text: string }).text.trim() : '';
      if (!text) return error(400, 'validation_failed', 'text is required', { fields: { text: 'required' } });
      if (text.length > TUTOR_MESSAGE_MAX_CHARS)
        return error(400, 'validation_failed', `text exceeds ${TUTOR_MESSAGE_MAX_CHARS} characters`, {
          fields: { text: 'too_long' },
        });
      const turns = turnsOf(u, th);
      if (turns.limit !== null && th.turns_used >= turns.limit) {
        return error(429, 'quota_exceeded', 'Thread turn limit reached', {
          quota: {
            feature: 'ai_tutor_thread_turns',
            period: 'lifetime',
            scope: 'thread',
            thread_id: th.id,
            limit: turns.limit,
            used: th.turns_used,
            remaining: 0,
          },
          feature: 'ai_tutor_thread_turns',
          upgrade: true,
        });
      }
      const now = nowIso();
      const userMsg: MockMessageRecord = { id: uuid(), role: 'user', text, ai_task_id: null, created_at: now };
      const replyId = uuid();
      if (INJECTION.test(text)) {
        // Guard từ chối: ai_tasks.status = refused, không gọi model chính, không trừ lượt/quota
        const aiTaskId = d.recordTask(u.id, 'tutor_chat');
        const reply: MockMessageRecord = {
          id: replyId,
          role: 'assistant',
          text: '',
          ai_task_id: aiTaskId,
          created_at: now,
          refused: true,
          refusal_code: 'injection',
          suggested_followups: [],
          citations: [],
        };
        th.messages.push(userMsg, reply);
        th.title ??= text.slice(0, 80);
        th.updated_at = now;
        persist();
        const data: TutorReply = {
          message_id: replyId,
          user_message_id: userMsg.id,
          reply_markdown: '',
          actions: [],
          suggested_followups: [],
          grounded_on: [],
          citations: [],
          refused: true,
          refusal_code: 'injection',
          turns: turnsOf(u, th),
        };
        return sse([
          { event: 'start', data: { ai_task_id: aiTaskId, cached: false } },
          { event: 'result', data: { data, ai_task_id: aiTaskId, cached: false }, delayMs: 150 },
          { event: 'done', data: {} },
        ]);
      }
      const over = d.quotaExceeded(u, 'ai_tutor');
      if (over) return over;
      d.consumeQuota(u, 'ai_tutor');
      const aiTaskId = d.recordTask(u.id, 'tutor_chat');
      const lang = u.explain_locale ?? locale;
      const { markdown, citations, followups } = composeReply(th, text, lang);
      const deltas = chunks(markdown).map((t) => ({ event: 'delta', data: { text: t }, delayMs: 40 }));
      const fail = d.takeAiFailure();
      if (fail) {
        d.refundQuota(u, 'ai_tutor');
        persist();
        return sse([
          { event: 'start', data: { ai_task_id: aiTaskId, cached: false } },
          ...deltas.slice(0, 3),
          {
            event: 'error',
            data: { code: fail, message: fail === 'ai_timeout' ? 'timeout' : 'provider_error' },
            delayMs: 150,
          },
          { event: 'done', data: {} },
        ]);
      }
      th.turns_used += 1;
      const reply: MockMessageRecord = {
        id: replyId,
        role: 'assistant',
        text: markdown,
        ai_task_id: aiTaskId,
        created_at: new Date(Date.now() + 1).toISOString(),
        refused: false,
        refusal_code: null,
        suggested_followups: followups,
        citations,
      };
      th.messages.push(userMsg, reply);
      th.title ??= text.slice(0, 80);
      th.updated_at = reply.created_at;
      persist();
      const data: TutorReply = {
        message_id: replyId,
        user_message_id: userMsg.id,
        reply_markdown: markdown,
        actions: [],
        suggested_followups: followups,
        grounded_on: citations.length ? ['referenced_question'] : [],
        citations,
        refused: false,
        refusal_code: null,
        turns: turnsOf(u, th),
      };
      return sse([
        { event: 'start', data: { ai_task_id: aiTaskId, cached: false } },
        ...deltas,
        { event: 'result', data: { data, ai_task_id: aiTaskId, cached: false }, delayMs: 80 },
        { event: 'done', data: {} },
      ]);
    }),

    // ----------------------------------------------------------------- tra từ & TTS
    route('GET', '/dictionary/lookup', ({ url, locale }) => {
      const u = d.requireUser();
      if (u instanceof Response) return u;
      const lk = locked(u);
      if (lk) return lk;
      const query = (url.searchParams.get('q') ?? url.searchParams.get('term') ?? '').trim();
      if (!query || query.length > 500)
        return error(400, 'validation_failed', 'q is required', { fields: { q: 'required' } });
      const ctx = (url.searchParams.get('context') ?? '').trim().slice(0, 300);
      const ai = url.searchParams.get('ai') ?? 'auto';
      const lang = url.searchParams.get('locale') ?? u.explain_locale ?? locale;
      const norm = normalizeLookupTerm(query);
      const hit = findEntry(norm);
      if (hit) return json(200, entryDto(u, query, hit.e, hit.matched, lang));
      const words = lookupWordCount(norm);
      const suggestions =
        words === 1
          ? MOCK_DICTIONARY.map((e) => ({
              headword: e.headword,
              similarity: Math.round(trigramSimilarity(norm, e.headword) * 100) / 100,
            }))
              .filter((s) => s.similarity >= 0.3)
              .sort((a, b) => b.similarity - a.similarity)
              .slice(0, 5)
          : [];
      const base = { ...emptyEntry(u, query, lang), suggestions };
      // auto: có gợi ý gần (≥ 0,6) với từ đơn → không gọi AI
      if (ai === 'never' || (ai === 'auto' && words === 1 && (suggestions[0]?.similarity ?? 0) >= 0.6))
        return json(200, base);
      const cacheKey = `${norm}|${words > 4 ? '' : ctx.toLowerCase()}|${lang}`;
      const cached = state.translations[cacheKey];
      if (cached)
        return json(200, {
          ...base,
          source: 'ai',
          meaning_local: cached,
          translation: { text: cached, needs_review: words > 4, ai_task_id: null },
          cached: true,
        });
      const over = d.quotaExceeded(u, 'dictionary_ai');
      if (over) return over;
      d.consumeQuota(u, 'dictionary_ai');
      const aiTaskId = d.recordTask(u.id, 'segment_translate');
      const text = mockTranslate(query, lang);
      state.translations[cacheKey] = text;
      persist();
      return json(200, {
        ...base,
        source: 'ai',
        meaning_local: text,
        translation: { text, needs_review: words > 4, ai_task_id: aiTaskId },
        cached: false,
      });
    }),
    route('GET', '/tts', ({ url }) => {
      const u = d.requireUser();
      if (u instanceof Response) return u;
      const text = (url.searchParams.get('text') ?? '').trim();
      if (!text || text.length > 500) return error(400, 'validation_failed', 'text is required');
      const voiceIn = url.searchParams.get('voice') ?? 'en-US-neural-f';
      const voice = voiceIn.startsWith('en-GB') ? 'en-GB-SoniaNeural' : 'en-US-JennyNeural';
      const t = signedTts(text, voice);
      persist();
      return json(200, { url: t.url, duration_ms: 900, expires_at: t.expires_at, cached: t.cached, voice });
    }),

    // ----------------------------------------------------------------- SRS
    route('POST', '/me/srs/cards', ({ body }) => {
      const u = d.requireUser();
      if (u instanceof Response) return u;
      const parsed = srsCardCreateSchema.safeParse(body);
      if (!parsed.success)
        return error(400, 'validation_failed', 'Invalid card', {
          issues: parsed.error.issues.map((i) => i.path.join('.')),
        });
      if (parsed.data.card_type !== 'vocab')
        return error(400, 'validation_failed', 'Only vocab cards are supported in S6');
      const hw = parsed.data.headword ? normalizeLookupTerm(parsed.data.headword) : null;
      const entry = parsed.data.ref_id
        ? MOCK_DICTIONARY.find((e) => e.id === parsed.data.ref_id)
        : hw
          ? findEntry(hw)?.e
          : undefined;
      if (parsed.data.ref_id && !entry) return error(404, 'not_found', 'Vocab item not found');
      const ref = entry ? entry.id : `hw:${hw}`;
      const key = `${u.id}|${ref}`;
      const existing = state.srsCards[key];
      const dto = (c: NonNullable<typeof existing>, created: boolean) => ({
        id: c.id,
        card_type: 'vocab',
        ref_id: entry?.id ?? c.id,
        state: 'new',
        due_at: c.created_at,
        stability: null,
        difficulty: null,
        reps: 0,
        lapses: 0,
        payload: { headword: c.headword, ...(c.context ? { context: c.context } : {}) },
        created,
      });
      if (existing) return json(200, dto(existing, false));
      const over = d.quotaExceeded(u, 'srs_new_cards');
      if (over) return over;
      d.consumeQuota(u, 'srs_new_cards');
      const card = {
        id: uuid(),
        user_id: u.id,
        ref_id: ref,
        headword: entry?.headword ?? hw ?? '',
        created_at: nowIso(),
        context: parsed.data.context ?? null,
      };
      state.srsCards[key] = card;
      persist();
      return json(201, dto(card, true));
    }),

    // ----------------------------------------------------------------- ghi chú
    route('GET', '/notes', ({ url }) => {
      const u = d.requireUser();
      if (u instanceof Response) return u;
      const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
      const qv = url.searchParams.get('question_version_id');
      const qid = url.searchParams.get('question_id');
      const att = url.searchParams.get('attempt_id');
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 20));
      const offset = dec(url.searchParams.get('cursor'));
      const all = Object.values(state.notes)
        .filter(
          (n) =>
            n.user_id === u.id &&
            (!q || n.body.toLowerCase().includes(q)) &&
            (!qv || n.question_version_id === qv) &&
            (!qid || n.question_id === qid) &&
            (!att || n.attempt_id === att),
        )
        .sort((x, y) => y.updated_at.localeCompare(x.updated_at));
      return json(200, {
        data: all.slice(offset, offset + limit).map(noteDto),
        next_cursor: offset + limit < all.length ? enc(offset + limit) : null,
      });
    }),
    route('POST', '/notes', ({ body }) => {
      const u = d.requireUser();
      if (u instanceof Response) return u;
      const lk = locked(u);
      if (lk) return lk;
      const b = (body ?? {}) as {
        body?: unknown;
        question_version_id?: string;
        attempt_id?: string;
        question_id?: string;
        test_set_id?: string;
      };
      const clean = cleanBody(b.body);
      if (clean instanceof Response) return clean;
      const q = b.question_version_id ? d.findQuestionByVersion(b.question_version_id) : undefined;
      if (b.question_version_id && !q) return error(404, 'not_found', 'Question version not found');
      if (b.attempt_id && state.attempts[b.attempt_id]?.user_id !== u.id)
        return error(404, 'not_found', 'Attempt not found');
      const now = nowIso();
      const n: Note & { user_id: string } = {
        id: uuid(),
        user_id: u.id,
        body: clean,
        question_id: q?.question_id ?? b.question_id ?? null,
        question_version_id: b.question_version_id ?? null,
        attempt_id: b.attempt_id ?? null,
        test_set_id: b.test_set_id ?? null,
        created_at: now,
        updated_at: now,
      };
      state.notes[n.id] = n;
      persist();
      return json(201, noteDto(n));
    }),
    route('PUT', '/notes', ({ body }) => {
      const u = d.requireUser();
      if (u instanceof Response) return u;
      const lk = locked(u);
      if (lk) return lk;
      const b = (body ?? {}) as {
        body?: unknown;
        question_version_id?: string;
        attempt_id?: string;
        question_id?: string;
        test_set_id?: string;
      };
      const clean = cleanBody(b.body);
      if (clean instanceof Response) return clean;
      const existing = Object.values(state.notes)
        .filter(
          (n) =>
            n.user_id === u.id &&
            ((b.question_id && n.question_id === b.question_id) ||
              (b.question_version_id && n.question_version_id === b.question_version_id) ||
              (!b.question_id && !b.question_version_id && b.test_set_id && n.test_set_id === b.test_set_id)),
        )
        .sort((x, y) => y.updated_at.localeCompare(x.updated_at))[0];
      const now = nowIso();
      if (existing) {
        existing.body = clean;
        existing.updated_at = now;
        persist();
        return json(200, noteDto(existing));
      }
      const n: Note & { user_id: string } = {
        id: uuid(),
        user_id: u.id,
        body: clean,
        question_id: b.question_id ?? null,
        question_version_id: b.question_version_id ?? null,
        attempt_id: b.attempt_id ?? null,
        test_set_id: b.test_set_id ?? null,
        created_at: now,
        updated_at: now,
      };
      state.notes[n.id] = n;
      persist();
      return json(200, noteDto(n));
    }),
    route('PATCH', '/notes/{noteId}', ({ params, body }) => {
      const u = d.requireUser();
      if (u instanceof Response) return u;
      const lk = locked(u);
      if (lk) return lk;
      const n = state.notes[params.noteId!];
      if (!n || n.user_id !== u.id) return error(404, 'not_found', 'Note not found');
      const clean = cleanBody((body as { body?: unknown })?.body);
      if (clean instanceof Response) return clean;
      n.body = clean;
      n.updated_at = nowIso();
      persist();
      return json(200, noteDto(n));
    }),
    route('DELETE', '/notes/{noteId}', ({ params }) => {
      const u = d.requireUser();
      if (u instanceof Response) return u;
      const lk = locked(u);
      if (lk) return lk;
      const n = state.notes[params.noteId!];
      if (!n || n.user_id !== u.id) return error(404, 'not_found', 'Note not found');
      delete state.notes[n.id];
      persist();
      return empty(204);
    }),

    // ----------------------------------------------------------------- thông báo & Web Push
    route('GET', '/push/vapid-public-key', () => json(200, { public_key: MOCK_VAPID_PUBLIC_KEY, enabled: true })),
    route('GET', '/me/notification-preferences', () => {
      const u = d.requireUser();
      if (u instanceof Response) return u;
      const p = state.prefs[u.id] ?? DEFAULT_PREFS;
      return json(200, {
        ...p,
        push_subscriptions: Object.values(state.pushSubs).filter((s) => s.user_id === u.id).length,
      });
    }),
    route('PATCH', '/me/notification-preferences', ({ body }) => {
      const u = d.requireUser();
      if (u instanceof Response) return u;
      const parsed = notificationPreferencesPatchSchema.safeParse(body);
      if (!parsed.success)
        return error(400, 'validation_failed', 'Invalid preferences', {
          issues: parsed.error.issues.map((i) => i.path.join('.')),
        });
      const cur = state.prefs[u.id] ?? DEFAULT_PREFS;
      const next: NotificationPreferences = {
        channels: { ...cur.channels, ...(parsed.data.channels ?? {}) },
        quiet_hours: parsed.data.quiet_hours ?? cur.quiet_hours,
        reminder_times: parsed.data.reminder_times ?? cur.reminder_times,
        updated_at: nowIso(),
      };
      state.prefs[u.id] = next;
      persist();
      return json(200, {
        ...next,
        push_subscriptions: Object.values(state.pushSubs).filter((s) => s.user_id === u.id).length,
      });
    }),
    route('GET', '/me/push-subscriptions', () => {
      const u = d.requireUser();
      if (u instanceof Response) return u;
      const data = Object.values(state.pushSubs)
        .filter((s) => s.user_id === u.id)
        .sort((x, y) => y.created_at.localeCompare(x.created_at))
        .map((s) => ({
          id: s.id,
          endpoint_origin: new URL(s.endpoint).origin,
          user_agent: s.user_agent,
          locale: s.locale,
          created_at: s.created_at,
          last_success_at: null,
          expires_at: null,
        }));
      return json(200, { data, next_cursor: null });
    }),
    route('POST', '/me/push-subscriptions', ({ body }) => {
      const u = d.requireUser();
      if (u instanceof Response) return u;
      const parsed = pushSubscriptionInputSchema.safeParse(body);
      if (!parsed.success)
        return error(400, 'validation_failed', 'Invalid push subscription', {
          issues: parsed.error.issues.map((i) => i.path.join('.')),
        });
      const existing = Object.values(state.pushSubs).find((s) => s.endpoint === parsed.data.endpoint);
      const now = nowIso();
      const rec = existing ?? {
        id: uuid(),
        user_id: u.id,
        endpoint: parsed.data.endpoint,
        keys: parsed.data.keys,
        user_agent: parsed.data.user_agent ?? null,
        locale: parsed.data.locale ?? null,
        created_at: now,
      };
      Object.assign(rec, {
        user_id: u.id,
        keys: parsed.data.keys,
        user_agent: parsed.data.user_agent ?? rec.user_agent,
        locale: parsed.data.locale ?? rec.locale,
      });
      state.pushSubs[rec.id] = rec;
      persist();
      return json(existing ? 200 : 201, {
        id: rec.id,
        endpoint_origin: new URL(rec.endpoint).origin,
        user_agent: rec.user_agent,
        locale: rec.locale,
        created_at: rec.created_at,
        last_success_at: null,
        expires_at: null,
        created: !existing,
      });
    }),
    route('DELETE', '/me/push-subscriptions/{subscriptionId}', ({ params }) => {
      const u = d.requireUser();
      if (u instanceof Response) return u;
      const s = state.pushSubs[params.subscriptionId!];
      if (!s || s.user_id !== u.id) return error(404, 'not_found', 'Subscription not found');
      delete state.pushSubs[s.id];
      persist();
      return empty(204);
    }),
  ];
}

/** Ghi chú mới nhất của người học cho một câu (ReviewItem.note) – ưu tiên ghi chú gắn đúng attempt */
export function latestNoteFor(
  state: MockState,
  userId: string,
  questionVersionId: string,
  attemptId: string,
): Note | null {
  const list = Object.values(state.notes)
    .filter((n) => n.user_id === userId && n.question_version_id === questionVersionId)
    .sort(
      (x, y) =>
        Number(y.attempt_id === attemptId) - Number(x.attempt_id === attemptId) ||
        y.updated_at.localeCompare(x.updated_at),
    );
  const n = list[0];
  if (!n) return null;
  const { user_id: _u, ...rest } = n;
  return rest;
}
