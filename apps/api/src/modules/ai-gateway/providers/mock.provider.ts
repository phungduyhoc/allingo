import type { AiProvider, AiTaskCode } from '@allingo/schemas';
import type { ModelProviderAdapter, ProviderCallOptions, ProviderResult, ProviderStreamChunk } from '../core/types.js';
import { foldText, localGuard, redactPii } from '../core/guard-rules.js';

/**
 * MockProvider: sinh đầu ra HỢP LỆ theo Zod cho 15 task_code mà không gọi model (AI_PROVIDER=mock hoặc thiếu khoá).
 * Đọc biến từ user prompt (chuỗi "key: value" trong <data>/<user_input>) để đầu ra bám nội dung thật (explain đúng correct_option…).
 * Dùng trong dev/test/CI; KHÔNG dùng ở production.
 */
export class MockProvider implements ModelProviderAdapter {
  readonly provider: AiProvider = 'mock';
  constructor(private readonly opts: { latencyMs?: number; failTaskCodes?: Set<string>; invalidOnce?: Set<string> } = {}) {}

  isConfigured(): boolean {
    return true;
  }

  async generate(opts: ProviderCallOptions): Promise<ProviderResult> {
    if (this.opts.latencyMs) await new Promise((r) => setTimeout(r, this.opts.latencyMs));
    if (this.opts.failTaskCodes?.has(opts.taskCode)) throw new Error(`mock provider failure for ${opts.taskCode}`);
    const user = opts.messages.filter((m) => m.role === 'user').at(-1)?.content ?? '';
    let payload: unknown = buildMock(opts.taskCode, user);
    if (this.opts.invalidOnce?.has(opts.taskCode)) {
      this.opts.invalidOnce.delete(opts.taskCode);
      payload = { bogus: true };
    }
    const text = JSON.stringify(payload);
    return { text, tokensIn: Math.ceil(user.length / 4), tokensOut: Math.ceil(text.length / 4), costUsd: 0, modelId: 'mock-1', provider: 'mock' };
  }

  async *stream(opts: ProviderCallOptions): AsyncIterable<ProviderStreamChunk> {
    const result = await this.generate(opts);
    const size = Math.max(24, Math.ceil(result.text.length / 6));
    for (let i = 0; i < result.text.length; i += size) {
      yield { type: 'delta', text: result.text.slice(i, i + size) };
      if (this.opts.latencyMs) await new Promise((r) => setTimeout(r, 15));
    }
    yield { type: 'final', result };
  }
}

const KV = /^([a-zA-Z_][a-zA-Z0-9_]*):\s?(.*)$/;

/**
 * Trích "key: value" từ prompt đã render. Dòng dạng `a: x | b: y` (template generate/diagnose/summarize) tách thành nhiều khoá
 * khi MỌI đoạn đều có dạng khoá; chú thích cuối dòng `   # …` bị bỏ.
 */
export function extractVars(user: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of user.split('\n')) {
    const line = raw.trim().replace(/\s{2,}#\s.*$/, '');
    const segs = line.split(' | ');
    if (segs.length > 1 && segs.every((x) => KV.test(x.trim()))) {
      for (const seg of segs) {
        const m = KV.exec(seg.trim())!;
        out[m[1]!] = m[2] ?? '';
      }
      continue;
    }
    const m = KV.exec(line);
    if (m) out[m[1]!] = m[2] ?? '';
  }
  return out;
}

/** Nội dung trong <user_input>…</user_input> */
export function userInputOf(user: string): string {
  return (user.split('<user_input>')[1] ?? '').split('</user_input>')[0] ?? '';
}

const parseJson = <T>(s: string | undefined, fallback: T): T => {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

/** Số phút người học nói mình có (mock plan_adjust): ưu tiên "Tuần tới có thể học: N phút", rồi "chỉ N giờ|tiếng|phút", "only N hours|minutes" */
export function mockAvailableMinutes(text: string): number | null {
  const t = text.toLowerCase();
  const avail = /(?:có thể học|available next week)[^0-9]{0,12}(\d+(?:[.,]\d+)?)\s*(phút|minutes?|giờ|tiếng|hours?|h)(?!\p{L})/u.exec(t);
  const only = avail ?? /(?:chỉ(?: còn| có)?|only)\s*(\d+(?:[.,]\d+)?)\s*(phút|minutes?|giờ|tiếng|hours?|h)(?!\p{L})/u.exec(t);
  if (!only) return null;
  const n = Number(only[1]!.replace(',', '.'));
  return Math.round(/^(phút|min)/.test(only[2]!) ? n : n * 60);
}

export function buildMock(taskCode: AiTaskCode, user: string): unknown {
  const v = extractVars(user);
  switch (taskCode) {
    case 'explain_mcq': {
      const options = parseJson<Array<{ key: string; text: string }>>(v.options, []);
      const correct = v.correct_option ?? options[0]?.key ?? 'A';
      const rawChosen = v.learner_chosen_option ?? v.chosen_option;
      const chosen = rawChosen && rawChosen !== 'null' && rawChosen !== '' ? rawChosen : null;
      const correctText = options.find((o) => o.key === correct)?.text ?? '';
      const others = Object.fromEntries(options.filter((o) => o.key !== correct).map((o) => [o.key, `"${o.text}" không hợp ngữ cảnh/ngữ pháp của câu (mock).`]));
      return {
        tested_point: v.question_type === 'mcq_single' ? 'Điểm ngữ pháp/từ vựng của câu (mock)' : 'Điểm kiểm tra (mock)',
        correct_option: correct,
        why_correct: `Đáp án ${correct} "${correctText}" đúng vì khớp với dấu hiệu trong đề: ${(v.stem ?? '').slice(0, 80)} (mock)`,
        why_others_wrong: others,
        chosen_option_trap: chosen && chosen !== correct ? `Bạn chọn ${chosen}: bẫy thường gặp là dạng từ/thì gần giống (mock).` : null,
        how_to_spot: 'Tìm dấu hiệu thời gian/từ loại đứng cạnh chỗ trống rồi loại trừ (mock).',
        related_points: [{ type: 'strategy', code: 'eliminate_distractors', label: 'Loại trừ phương án' }],
        key_vocab: options.slice(0, 2).map((o) => ({ term: o.text, reading: null, meaning: `nghĩa của "${o.text}" (mock)` })),
      };
    }
    case 'guard_classify': {
      // Mock guard: luật cục bộ (EN/VI có/không dấu) + mẫu ngoài phạm vi + PII còn sót; model thật phân loại ngữ nghĩa
      const raw = userInputOf(user).trim();
      const folded = foldText(raw);
      const local = localGuard(raw);
      const leakInExam = v.exam_mode === 'true' && /(dap an|answer key|answers?|goi y|hint)/.test(folded);
      const offTopic = /\b(bitcoin|crypto|chung khoan|ca cuoc|xo so|stock market|write (me )?(a |some )?(python|javascript|code)|viet code|lap trinh)\b/.test(folded);
      const pii = redactPii(raw);
      const category = local.category !== 'ok' ? local.category : leakInExam ? 'answer_leak' : offTopic ? 'off_topic' : pii.redacted ? 'pii' : 'ok';
      return { allowed: category === 'ok', category, reason: category === 'ok' ? 'Nội dung học tập hợp lệ (mock)' : `Phát hiện ${category} (mock)`, redacted_text: category === 'pii' ? pii.text : null };
    }
    case 'tutor_chat': {
      // Tin hiện tại = khối <user_input> CUỐI (lượt user trong lịch sử cũng được bọc <user_input> – S6)
      const msg = (v.message ?? (user.split('<user_input>').at(-1) ?? '').split('</user_input>')[0] ?? '').trim();
      return {
        reply_markdown: `Câu hỏi của bạn: "${msg.slice(0, 120)}". Đây là câu trả lời mẫu từ gia sư AI (mock). Hãy xem lại dấu hiệu trong đề và thử giải thích lý do bạn chọn phương án đó.`,
        actions: [],
        suggested_followups: ['Vì sao các phương án khác sai?', 'Cho tôi một ví dụ tương tự'],
        grounded_on: ['referenced_question'],
        refused: false,
      };
    }
    case 'diagnose_rl': {
      // Số liệu chép đúng từ <data> (numeric fidelity): loại sai nhiều nhất trong by_question_type
      const byType = parseJson<Record<string, { correct?: number; total?: number }>>(v.by_question_type, {});
      const ranked = Object.entries(byType)
        .filter(([, x]) => (x.total ?? 0) > 0)
        .sort((a, b) => ((a[1].correct ?? 0) / (a[1].total ?? 1)) - ((b[1].correct ?? 0) / (b[1].total ?? 1)) || (b[1].total ?? 0) - (a[1].total ?? 0));
      const [type, stat] = ranked[0] ?? ['vocabulary', { correct: 0, total: 0 }];
      const wrong = (stat.total ?? 0) - (stat.correct ?? 0);
      const wrongItems = parseJson<Array<{ stem_excerpt?: string; chosen?: string; correct?: string }>>(v.wrong_items, []);
      const ev = wrongItems[0]?.stem_excerpt ? `"${wrongItems[0].stem_excerpt.slice(0, 120)}" – bạn chọn ${wrongItems[0].chosen ?? '—'}, đáp án ${wrongItems[0].correct ?? '—'} (mock)` : `Sai ${wrong}/${stat.total ?? 0} câu ${type} (mock)`;
      return {
        top_error_type: type,
        evidence: [ev.slice(0, 240)],
        why: `Dạng ${type} sai ${wrong}/${stat.total ?? 0}: thường do chọn từ nghĩa gần nhưng sai từ loại/collocation (mock).`.slice(0, 500),
        steps: ['Xác định từ loại cần điền dựa vào từ đứng trước và sau chỗ trống', 'Loại phương án sai từ loại trước khi xét nghĩa', 'Đọc lại cả câu với phương án đã chọn để kiểm tra'],
        check_question: { stem: 'Customers who register early are ______ to a discount.', options: ['entitled', 'available', 'capable'], answer: 'entitled', explanation: 'be entitled to + N (mock)' },
        encouragement: 'Bạn đang đi đúng hướng – giữ nhịp 20 phút mỗi ngày nhé!',
      };
    }
    case 'summarize_attempt': {
      const byType = parseJson<Record<string, { correct?: number; total?: number }>>(v.by_subskill, {});
      const sections = parseJson<Record<string, { correct?: number; total?: number }>>(v.by_section, {});
      const pool = Object.keys(byType).length ? byType : sections;
      const worst = Object.entries(pool)
        .filter(([, x]) => (x.total ?? 0) > 0)
        .sort((a, b) => ((a[1].correct ?? 0) / (a[1].total ?? 1)) - ((b[1].correct ?? 0) / (b[1].total ?? 1)))[0];
      const area = worst?.[0] ?? 'part5';
      const tot = worst?.[1].total ?? 0;
      const wrongN = tot - (worst?.[1].correct ?? 0);
      const allowed = parseJson<string[]>(v.allowed_task_types, ['part_drill']);
      const score = v.scaled_score && v.scaled_score !== 'null' ? v.scaled_score : null;
      return {
        headline: (score ? `Điểm ước tính ${score} – tiếp tục củng cố ${area} (mock)` : `Tiếp tục củng cố ${area} (mock)`).slice(0, 140),
        weakest: { area, evidence: `wrong ${wrongN}/${tot} in ${area}`.slice(0, 120) },
        next_tasks: [{ task_type: allowed[0] ?? 'part_drill', ref_hint: area, reason: `Luyện thêm ${area} (mock)`.slice(0, 140) }],
        trend_note: null,
      };
    }
    case 'grade_writing_ielts': {
      const cf = (band: number) => ({ band, strengths: ['Ý rõ (mock)'], issues: ['Thiếu ví dụ cụ thể (mock)'], how_to_improve: 'Thêm một ví dụ cho mỗi luận điểm (mock)' });
      return {
        criterion_scores: { task: 6, coherence_cohesion: 6, lexical_resource: 6.5, grammatical_range_accuracy: 6 },
        overall: 6,
        weakest_criterion: 'task',
        flags: { off_topic: false, too_short: false, memorized_template: false, language_mismatch: false, plagiarism_suspected: false },
        feedback: { summary: 'Bài viết đáp ứng yêu cầu ở mức band 6 (mock).', by_criterion: { task: cf(6), coherence_cohesion: cf(6), lexical_resource: cf(6.5), grammatical_range_accuracy: cf(6) }, fix_first: 'Làm rõ ý kiến cá nhân ngay trong mở bài (mock).' },
        errors: [],
        model_answer: { text: 'Model answer (mock)…', target_band: 7.5, highlights: Array.from({ length: 6 }, (_, i) => ({ phrase: `phrase ${i + 1}`, function: 'cohesion' })) },
        confidence: 'low',
      };
    }
    case 'grade_writing_toeic':
      return { question_type: 'q8_essay', score: 3, max_score: 5, requirements_met: [{ requirement: 'Nêu ý kiến', met: true }], rationale: 'Mock rationale', errors: [], improved_version: 'Improved (mock)', confidence: 'low' };
    case 'grade_speaking_ielts': {
      const cf = (band: number) => ({ band, strengths: ['Trôi chảy (mock)'], issues: ['Ngập ngừng khi tìm từ (mock)'], how_to_improve: 'Luyện nói theo cụm (mock)' });
      const pron = Number(parseJson<{ given_pronunciation_band?: number }>(v.pa_summary, {}).given_pronunciation_band ?? 6);
      return {
        criterion_scores: { fluency_coherence: 6, lexical_resource: 6, grammatical_range_accuracy: 6, pronunciation: pron },
        overall: 6,
        weakest_criterion: 'fluency_coherence',
        flags: { too_short: false, off_topic: false, memorized_script: false, language_mismatch: false },
        feedback: { summary: 'Phần nói đạt band 6 (mock).', by_criterion: { fluency_coherence: cf(6), lexical_resource: cf(6), grammatical_range_accuracy: cf(6), pronunciation: cf(pron) }, fix_first: 'Giảm từ đệm (mock).' },
        errors: [],
        model_answer: { text: 'Model answer (mock)', target_band: 7, highlights: Array.from({ length: 5 }, (_, i) => ({ phrase: `phrase ${i + 1}`, function: 'linking' })) },
        connectors_used: ['however', 'for example'],
        confidence: 'low',
      };
    }
    case 'grade_speaking_toeic':
      return { question_type: 'q11_express_opinion', score: 3, max_score: 5, dimension_notes: { relevance_completeness: 'Mock' }, rationale: 'Mock', errors: [], improved_response: 'Improved (mock)', confidence: 'low' };
    case 'upgrade_phrasing':
      return { verdict: 'partly', note: 'Câu đã tốt hơn nhưng vẫn thiếu mạo từ (mock).', remaining_issue: 'article', reveal_suggestion: false };
    case 'generate_questions': {
      // Mock: sinh đúng `count` câu (≤ 50) theo chủ đề; nếu có forbidden_recent_stems và count ≥ 5, câu CUỐI cố ý lặp lại
      // stem đầu danh sách để kiểm chứng đường ống gắn cờ trùng (A62) – model thật bị cấm điều này trong system prompt.
      const count = Math.max(1, Math.min(Number(v.count ?? 1) || 1, 50));
      const topic = (v.topic ?? 'general').trim() || 'general';
      const forbidden = parseJson<string[]>(v.forbidden_recent_stems, []);
      const subskills = parseJson<string[]>(v.allowed_subskills, []);
      const level = parseJson<{ level?: string }>(v.difficulty_target, {}).level ?? 'B1';
      const T = [
        { stem: (t: string, i: number) => `The ${t} team ______ the delivery schedule before the end of quarter ${i}.`, opts: ['will review', 'reviewing', 'reviewed', 'to review'], key: 'A', why: 'will + V (future)' },
        { stem: (t: string, i: number) => `All ${t} invoices must be submitted ______ Friday, ${i} March.`, opts: ['by', 'until', 'since', 'during'], key: 'A', why: 'by + deadline' },
        { stem: (t: string, i: number) => `Ms. Tran was ______ to lead the new ${t} project in region ${i}.`, opts: ['selected', 'selecting', 'selection', 'selects'], key: 'A', why: 'be + V3 (passive)' },
        { stem: (t: string, i: number) => `Because of the ${t} delay, shipment ${i} arrived ______ than expected.`, opts: ['later', 'lately', 'latest', 'late'], key: 'A', why: 'comparative + than' },
        { stem: (t: string, i: number) => `The warehouse manager asked staff to handle ${t} item ${i} ______.`, opts: ['carefully', 'careful', 'care', 'cared'], key: 'A', why: 'adverb modifies verb' },
        { stem: (t: string) => `Neither the driver ______ the dispatcher noticed the error on the ${t} form.`, opts: ['nor', 'or', 'and', 'but'], key: 'A', why: 'neither … nor' },
        { stem: (t: string) => `Our ${t} partner has offered free storage ______ the contract is renewed.`, opts: ['provided that', 'in spite of', 'because of', 'instead of'], key: 'A', why: 'conjunction + clause' },
        { stem: (t: string) => `Customers can track their ${t} orders online ______ any time of day.`, opts: ['at', 'on', 'in', 'by'], key: 'A', why: 'at any time' },
        { stem: (t: string) => `The new ${t} software is expected to reduce paperwork ______.`, opts: ['significantly', 'significant', 'significance', 'signify'], key: 'A', why: 'adverb after object' },
        { stem: (t: string) => `Ms. Le will be responsible ______ coordinating all ${t} vendors next year.`, opts: ['for', 'to', 'with', 'of'], key: 'A', why: 'responsible for + V-ing' },
      ];
      return {
        questions: Array.from({ length: count }, (_, i) => {
          const tpl = T[i % T.length]!;
          const dup = forbidden.length > 0 && count >= 5 && i === count - 1;
          const stem = dup ? forbidden[0]! : tpl.stem(topic, i + 1);
          const opts = ['A', 'B', 'C', 'D'].map((k, j) => ({ key: k, text: tpl.opts[j]! }));
          return {
            content: { type: 'mcq_single', stem, options: opts, answer_key: { correct: tpl.key }, explanation: { en: `${tpl.why} (mock)`, vi: `${tpl.why} (mock)` }, tags: [topic] },
            answer: tpl.key,
            distractor_rationale: Object.fromEntries(opts.filter((o) => o.key !== tpl.key).map((o) => [o.key, `"${o.text}" sai dạng/nghĩa (mock)`])),
            explanation_seed: `${tpl.why}; distractors differ in form (mock)`,
            difficulty_estimate: { level, irt_b: 0 },
            subskill_codes: subskills.length ? [subskills[i % subskills.length]!] : ['grammar'],
            trap_type: 'word_form',
            keywords: [topic, `item ${i + 1}`],
          };
        }),
      };
    }
    case 'generate_item_set':
      return mockItemSet(v);
    case 'check_question': {
      const item = parseJson<{ answer_key?: { correct?: string } }>(v.item, {});
      return {
        verdict: 'pass',
        unique_answer: true,
        key_correct: true,
        solved_answer: item.answer_key?.correct ?? null,
        issues: [],
        difficulty_estimate: { level: parseJson<{ level?: string }>(v.difficulty_target, {}).level ?? String(v.difficulty_target ?? 'B1').replace(/^"|"$/g, ''), irt_b: 0 },
        part_fit: true,
        bias_or_sensitivity: null,
        duplicate_risk: { level: 'low', reason: 'Không thấy trùng (mock)' },
        suggested_patch: null,
      };
    }
    case 'segment_translate': {
      const sentences = parseJson<Array<{ index: number; text: string }> | string[]>(v.sentences, []);
      return { translations: sentences.map((s, i) => ({ index: typeof s === 'string' ? i : s.index, text: `(mock dịch) ${typeof s === 'string' ? s : s.text}`.slice(0, 600), needs_review: false })) };
    }
    case 'plan_adjust': {
      // Bám câu lệnh/check-in: "Tuần tới có thể học: N phút" | "chỉ N giờ/tiếng/phút" | "only N hours/minutes" → giảm tải tuần tới;
      // không có con số → giữ nguyên (op none). Ngày đầu tuần đích lấy từ next_week_tasks (hoặc current_week_tasks).
      const text = userInputOf(user);
      const target = parseJson<Array<{ date?: string; est_minutes?: number; status?: string }>>(v.next_week_tasks, []);
      const tasks = target.length ? target : parseJson<Array<{ date?: string; est_minutes?: number; status?: string }>>(v.current_week_tasks, []);
      const minutes = mockAvailableMinutes(text);
      const load = tasks.filter((t) => t.status !== 'skipped' && t.status !== 'expired').reduce((a, t) => a + (t.est_minutes ?? 0), 0);
      const from = tasks.map((t) => t.date).filter((d): d is string => !!d).sort()[0] ?? null;
      if (minutes !== null && minutes < load) return { summary: `Giảm tải tuần tới từ ${load} xuống tối đa ${minutes} phút theo yêu cầu (mock).`, operations: [{ op: 'reduce_load_week', task_id: null, from_date: from, to_date: null, minutes, window: null, note: 'mock' }], needs_clarification: false, clarifying_question: null };
      return { summary: 'Giữ nguyên kế hoạch tuần tới (mock).', operations: [{ op: 'none', task_id: null, from_date: null, to_date: null, minutes: null, window: null, note: 'mock' }], needs_clarification: false, clarifying_question: null };
    }
    default:
      return {};
  }
}

/**
 * Mock generate_item_set (B2): một nhóm passage + `count` câu TẤT ĐỊNH theo (section, topic, số bộ đã sinh = độ dài
 * forbidden_recent_titles). Tên người/công ty hư cấu, tên miền .example. Part 6: chỗ trống [1]…[n]; Part 7 nhiều văn bản: ≥ 1 câu kết hợp.
 */
function mockItemSet(v: Record<string, string>): unknown {
  const count = Math.max(1, Math.min(Number(v.count ?? 3) || 3, 10));
  const textCount = Math.max(1, Math.min(Number(v.text_count ?? 1) || 1, 3));
  const topic = (v.topic ?? 'general').trim() || 'general';
  const section = (v.section_code ?? 'part7').trim();
  const kind = v.passage_kind === 'audio_script' ? 'audio_script' : 'reading_passage';
  const n = parseJson<string[]>(v.forbidden_recent_titles, []).length + 1;
  const subskills = parseJson<string[]>(v.allowed_subskills, []);
  const level = parseJson<{ level?: string }>(v.difficulty_target, {}).level ?? 'B1';
  const KEYS = ['A', 'B', 'C', 'D'] as const;
  const people: [string, string] = ([
    ['Lan Pham', 'Minh Vo'],
    ['Thu Nguyen', 'Kevin Hale'],
    ['Hoa Tran', 'Daniel Okafor'],
    ['Mai Le', 'Arjun Mehta'],
  ] as const)[n % 4]!.slice() as [string, string];
  const company = `${['Brightline', 'Northwind', 'Silverleaf', 'Harborview'][n % 4]} ${topic.charAt(0).toUpperCase()}${topic.slice(1)} Co.`;
  const item = (i: number, stem: string, correctText: string, wrong: [string, string, string], why: string) => {
    const keyIdx = (n + i) % 4;
    const texts = [...wrong];
    texts.splice(keyIdx, 0, correctText);
    const options = KEYS.map((k, j) => ({ key: k, text: texts[j]! }));
    const key = KEYS[keyIdx]!;
    return {
      content: { type: 'mcq_single', stem, options, answer_key: { correct: key }, explanation: { en: `${why} (mock)`, vi: `${why} (mock)` }, evidence: correctText, tags: [topic, section] },
      answer: key,
      distractor_rationale: Object.fromEntries(options.filter((o) => o.key !== key).map((o) => [o.key, `"${o.text}" không khớp văn bản (mock)`])),
      explanation_seed: `${why} (mock)`,
      difficulty_estimate: { level, irt_b: 0 },
      subskill_codes: subskills.length ? [subskills[i % subskills.length]!] : ['reading:detail'],
      trap_type: 'paraphrase',
      keywords: [topic, `set ${n}`],
    };
  };
  if (kind === 'audio_script') {
    const [w, m] = people;
    const title = `${section === 'part4' ? 'Talk' : 'Conversation'} #${n}: ${topic} schedule at ${company}`;
    const body =
      section === 'part4'
        ? `Narrator: Good morning, everyone, and welcome to ${company}. Today's ${topic} workshop starts at ten o'clock in Room ${200 + n}. Please collect your badge at the front desk before the session. Lunch will be served at noon, and the afternoon tour of the new facility begins at two. If you need help, ask ${w}, our coordinator.`
        : `Woman: Hi ${m.split(' ')[0]}, the ${topic} supplier just called. The delivery for order ${1000 + n} will arrive on Thursday instead of Tuesday.\nMan: Thursday? Then we should move the product demo to Friday.\nWoman: Good idea. Could you e-mail the clients about the new date this afternoon?\nMan: Sure. I'll also book the larger meeting room in case more people come.`;
    const qs = [
      item(0, section === 'part4' ? 'Where is the talk most likely taking place?' : 'What are the speakers mainly discussing?', section === 'part4' ? 'At a company workshop' : 'A change to a delivery date', section === 'part4' ? ['At a train station', 'In a restaurant', 'At a sports stadium'] : ['A new hiring policy', 'A broken machine', 'A holiday party'], 'Main idea stated at the start'),
      item(1, section === 'part4' ? 'What should listeners do before the session?' : 'What does the woman ask the man to do?', section === 'part4' ? 'Collect a badge' : 'Contact some clients', section === 'part4' ? ['Pay a fee', 'Submit a report', 'Move their cars'] : ['Cancel an order', 'Repair a printer', 'Hire an assistant'], 'Request stated in the middle'),
      item(2, section === 'part4' ? 'What will happen at two o’clock?' : 'What will the man probably do next?', section === 'part4' ? 'A facility tour will begin' : 'Reserve a room', section === 'part4' ? ['Lunch will be served', 'The workshop will end', 'A guest will arrive'] : ['Call the supplier', 'Leave the office', 'Print some tickets'], 'Detail near the end'),
    ];
    return { passage: { kind, title, texts: [{ title, body }] }, questions: Array.from({ length: count }, (_, i) => qs[i % qs.length]!) };
  }
  const docTypes = ['E-mail', 'Notice', 'Schedule'] as const;
  const docs = Array.from({ length: textCount }, (_, t) => {
    const type = docTypes[t]!;
    if (section === 'part6') {
      const blanks = Array.from({ length: count }, (_, i) => `[${i + 1}]`);
      return {
        title: type,
        body: `To: All staff\nFrom: ${people[0]}, ${company}\nSubject: ${topic} update #${n}\n\nDear colleagues,\n\nOur ${topic} team will ${blanks[0]} a new process next month. ${blanks[1] ?? ''} please read the attached guide before the training session.\n\nThe session will take place on the third floor. ${blanks[2] ?? ''} Questions can be sent to help@${topic}.example.\n\nThank you for your ${blanks[3] ?? ''} during this change.\n\n${people[0]}`,
      };
    }
    if (type === 'E-mail') return { title: type, body: `From: ${people[0]}\nTo: ${people[1]}\nSubject: ${topic} order ${2000 + n}\n\nHello ${people[1].split(' ')[0]},\n\nThank you for your order. Because of high demand, we can deliver it on Thursday, 14 May, instead of Monday. Please let me know if this date works for you.\n\nBest regards,\n${people[0]}, ${company}` };
    if (type === 'Notice') return { title: type, body: `${company} – Customer Notice\n\nFrom 1 May, deliveries will be made only on Tuesdays and Thursdays. Orders placed after 3:00 P.M. will be processed the next working day. Visit www.${topic}.example for details.` };
    return { title: type, body: `Delivery schedule – week of 12 May\nTuesday 13: Zone A\nThursday 15: Zone B (including order ${2000 + n})\nFriday 16: no deliveries (staff training)` };
  });
  const title = textCount > 1 ? docs.map((d) => d.title).join(' + ') : `${docs[0]!.title}: ${topic} #${n}`;
  const p6 = (i: number) =>
    item(i, `Question ${i + 1}: Choose the word or phrase that best completes blank [${i + 1}].`, ['introduce', 'Therefore,', 'Please arrive ten minutes early.', 'patience'][i % 4]!, [['introducing', 'introduction', 'introduced'], ['However,', 'Instead,', 'Otherwise,'], ['The building closed last year.', 'Lunch is not provided.', 'Parking is free on Sundays.'], ['patient', 'patiently', 'patients']][i % 4]! as [string, string, string], 'Grammar/cohesion of the blank');
  const p7 = [
    item(0, 'What is the main purpose of the e-mail?', 'To propose a new delivery date', ['To cancel an order', 'To request a payment', 'To announce a price change'], 'Purpose in the first lines'),
    item(1, 'What is indicated about the company?', 'It has a website for more information', ['It closes on Tuesdays', 'It is hiring drivers', 'It opened recently'], 'Detail in the notice/e-mail'),
    item(2, textCount > 1 ? 'Why most likely was the delivery moved to Thursday? (combine the texts)' : 'What should the customer do?', textCount > 1 ? 'Deliveries are made only on certain days' : 'Reply about the new date', textCount > 1 ? ['The driver was sick', 'The customer asked for it', 'The order was incomplete'] : ['Visit the office', 'Pay a deposit', 'Call a manager'], 'Cross-text inference'),
    item(3, 'The word "high" in the e-mail is closest in meaning to', 'great', ['tall', 'expensive', 'loud'], 'Vocabulary in context'),
    item(4, 'When will no deliveries be made?', 'On Friday, 16 May', ['On Tuesday, 13 May', 'On Thursday, 15 May', 'On Monday, 12 May'], 'Schedule detail'),
  ];
  return { passage: { kind, title, texts: docs }, questions: Array.from({ length: count }, (_, i) => (section === 'part6' ? p6(i) : p7[i % p7.length]!)) };
}
