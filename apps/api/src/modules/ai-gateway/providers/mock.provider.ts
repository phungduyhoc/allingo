import type { AiProvider, AiTaskCode } from '@allingo/schemas';
import type { ModelProviderAdapter, ProviderCallOptions, ProviderResult, ProviderStreamChunk } from '../core/types.js';

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

/** Trích "key: value" từ prompt đã render */
export function extractVars(user: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of user.split('\n')) {
    const m = /^([a-zA-Z_][a-zA-Z0-9_]*):\s?(.*)$/.exec(line.trim());
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
      const text = (user.split('<user_input>')[1] ?? '').split('</user_input>')[0]?.toLowerCase() ?? '';
      const injection = /ignore (all |the )?(previous|above) instructions|bỏ qua (mọi |các )?hướng dẫn|system prompt|you are now/.test(text);
      const leak = /(đáp án|answer key|answers?) (của |for )?(đề|bài|test) (đang|hiện)|give me (all )?the answers|cho (tôi|em) đáp án/.test(text) && v.exam_mode === 'true';
      const offTopic = /bitcoin|crypto|chứng khoán|cá cược/.test(text);
      const category = injection ? 'injection' : leak ? 'answer_leak' : offTopic ? 'off_topic' : 'ok';
      return { allowed: category === 'ok', category, reason: category === 'ok' ? 'Nội dung học tập hợp lệ (mock)' : `Phát hiện ${category} (mock)`, redacted_text: null };
    }
    case 'tutor_chat': {
      const msg = (v.message ?? userInputOf(user)).trim();
      return {
        reply_markdown: `Câu hỏi của bạn: "${msg.slice(0, 120)}". Đây là câu trả lời mẫu từ gia sư AI (mock). Hãy xem lại dấu hiệu trong đề và thử giải thích lý do bạn chọn phương án đó.`,
        actions: [],
        suggested_followups: ['Vì sao các phương án khác sai?', 'Cho tôi một ví dụ tương tự'],
        grounded_on: ['referenced_question'],
        refused: false,
      };
    }
    case 'diagnose_rl':
      return {
        top_error_type: 'vocabulary',
        evidence: ['Sai 3/5 câu từ vựng theo ngữ cảnh (mock)'],
        why: 'Bạn thường chọn từ có nghĩa gần nhưng không đúng collocation (mock).',
        steps: ['Ôn 20 collocation văn phòng', 'Làm 10 câu drill Part 5 từ vựng', 'Xem lại 5 câu sai hôm nay'],
        check_question: { stem: 'Customers who register early are ______ to a discount.', options: ['entitled', 'available', 'capable'], answer: 'entitled', explanation: 'be entitled to + N (mock)' },
        encouragement: 'Bạn đang đi đúng hướng – giữ nhịp 20 phút mỗi ngày nhé!',
      };
    case 'summarize_attempt':
      return {
        headline: `Điểm ước tính ${v.scaled_score ?? 'n/a'} – tiến bộ ổn định (mock)`,
        weakest: { area: 'part5:vocabulary_context', evidence: 'Sai 2/3 câu từ vựng (mock)' },
        next_tasks: [{ task_type: 'part_drill', ref_hint: 'part5', reason: 'Củng cố từ vựng theo ngữ cảnh' }],
        trend_note: null,
      };
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
      const count = Math.min(Number(v.count ?? 1) || 1, 5);
      return {
        questions: Array.from({ length: count }, (_, i) => ({
          content: {
            type: 'mcq_single',
            stem: `The committee ______ the proposal at next week's meeting (mock ${i + 1}).`,
            options: [
              { key: 'A', text: 'will discuss' },
              { key: 'B', text: 'discussed' },
              { key: 'C', text: 'discussing' },
              { key: 'D', text: 'has discussed' },
            ],
            answer_key: { correct: 'A' },
            tags: [],
          },
          answer: 'A',
          distractor_rationale: { B: 'quá khứ', C: 'V-ing', D: 'hoàn thành' },
          explanation_seed: 'next week → future simple',
          difficulty_estimate: { level: 'B1', irt_b: 0 },
          subskill_codes: ['verb_tense'],
          trap_type: 'tense_marker',
          keywords: ['next week', 'proposal'],
        })),
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
