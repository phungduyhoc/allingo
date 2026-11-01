import type { AiProvider, AiTaskCode } from '@allingo/schemas';
import type { ModelProviderAdapter, ProviderCallOptions, ProviderResult, ProviderStreamChunk } from '../core/types.js';
import { foldText, localGuard, redactPii } from '../core/guard-rules.js';

/**
 * MockProvider: sinh đầu ra HỢP LỆ theo Zod cho 14 task_code mà không gọi model (AI_PROVIDER=mock hoặc thiếu khoá).
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
    case 'plan_adjust':
      return { summary: 'Giảm tải tuần tới 30% theo yêu cầu (mock).', operations: [{ op: 'reduce_load_week', task_id: null, from_date: null, to_date: null, minutes: 90, window: null, note: 'mock' }], needs_clarification: false, clarifying_question: null };
    default:
      return {};
  }
}
