import { Injectable } from '@nestjs/common';
import { DEFAULT_PROGRAM, describeQuestion, type AiStreamEvent, type AnswerInput, type ExplainMcqOutput, type Explanation, type Locale } from '@allingo/schemas';
import { InsufficientCredits, NotFound, ValidationFailed } from '../../../shared/http/errors.js';
import { CatalogQueryService, type LoadedQuestion } from '../../catalog/index.js';
import { CreditService, FeatureGateService } from '../../billing/index.js';
import { UsersService } from '../../iam/index.js';
import { AiGatewayService } from '../core/ai-gateway.service.js';
import { ExplanationCacheService } from '../core/explanation-cache.service.js';
import { explainChoiceKey } from '../core/explain-key.js';
import { GuardrailsService } from '../core/guardrails.service.js';

export interface ExplainRequest {
  userId: string;
  questionVersionId: string;
  chosenOption?: string | null;
  attemptId?: string | null;
  /** C2: câu trả lời dạng nhiều mục (cá nhân hoá giải thích, khoá cache = mã băm) */
  answer?: AnswerInput | null;
  traceId?: string;
}

/**
 * Giải thích câu hỏi (explain_mcq, S5):
 * 1) Exam Mode → 403 (trước cả cache – §5.8); 2) chọn phiên bản prompt cho người dùng (active / canary theo hash);
 * 3) cache (question_version × chosen_option × explain_locale × prompt_version) hit → JSON ngay, ghi ai_tasks cache_hit
 *    (không trừ credit/quota, có ai_task_id để đánh giá 👍/👎); 4) miss → entitlement → credit → quota (Redis, giờ VN) → stream SSE.
 * AI thất bại (sự kiện error) hoặc lỗi giữa chừng → hoàn quota; credit chỉ trừ khi thành công (cùng transaction với cache).
 * Chỉ phiên bản ACTIVE ghi cache dùng chung (kết quả canary không ghi đè cache của nhóm active – A57).
 */
@Injectable()
export class ExplainService {
  constructor(
    private readonly gateway: AiGatewayService,
    private readonly cache: ExplanationCacheService,
    private readonly guard: GuardrailsService,
    private readonly catalog: CatalogQueryService,
    private readonly gate: FeatureGateService,
    private readonly credits: CreditService,
    private readonly users: UsersService,
  ) {}

  private toExplanation(out: ExplainMcqOutput, locale: string, cached: boolean, aiTaskId: string | null, promptVersionId: string | null): Explanation {
    return {
      correct_option: out.correct_option,
      why_correct: out.why_correct,
      why_others_wrong: out.why_others_wrong,
      how_to_spot: out.how_to_spot,
      related_points: out.related_points.map((p) => ({ type: p.type, code: p.code, label: p.label })),
      tested_point: out.tested_point,
      chosen_option_trap: out.chosen_option_trap ?? null,
      key_vocab: out.key_vocab.map((k) => ({ term: k.term, reading: k.reading ?? null, meaning: k.meaning })),
      locale,
      cached,
      ai_task_id: aiTaskId,
      prompt_version_id: promptVersionId,
    };
  }

  private async loadQuestion(questionVersionId: string): Promise<LoadedQuestion> {
    const map = await this.catalog.loadByVersionIds([questionVersionId]);
    const q = map.get(questionVersionId);
    if (!q) throw new NotFound('question_version', questionVersionId);
    return q;
  }

  private async localeOf(userId: string): Promise<Locale> {
    const u = await this.users.findById(userId);
    return (u?.explainLocale as Locale | undefined) ?? 'vi';
  }

  /** Dạng câu giải thích được (tự chấm – C2 mở rộng từ trắc nghiệm sang mọi dạng nhiều mục); essay/speaking/handwriting → 400 */
  static explainable(q: LoadedQuestion): boolean {
    return !['essay', 'speaking', 'handwriting'].includes(q.content.type);
  }

  /**
   * Biến cho template explain_mcq (nội dung câu nằm trong <user_input> theo template; không PII). C2: mọi dạng qua describeQuestion()
   * – `options` = lựa chọn dùng chung, `items` = mục đánh số kèm đáp án đúng/của người học, `instructions` = giới hạn từ.
   */
  static variablesOf(q: LoadedQuestion, chosen: string | null, locale: string, answer?: AnswerInput | null): Record<string, unknown> {
    const content = q.content;
    if (!ExplainService.explainable(q)) throw new ValidationFailed({ issues: [{ path: 'question_version_id', message: 'explain_mcq does not support this question type' }] });
    const mcqAnswer: AnswerInput | null = content.type === 'mcq_single' && chosen ? { type: 'mcq_single', selected: chosen } : null;
    const d = describeQuestion(content, answer ?? mcqAnswer);
    return {
      program: q.program_code,
      section_code: q.section_code,
      question_type: q.question_type,
      learner_level: 'B1',
      explanation_seed: content.explanation?.[locale as Locale] ?? content.explanation?.vi ?? content.explanation?.en ?? '',
      related_codes: q.subskill_codes,
      instructions: d.instructions ?? '',
      stem: d.stem,
      options: d.options,
      items: d.items,
      correct_option: d.correct_text,
      chosen_option: (content.type === 'mcq_single' ? chosen : d.chosen_text) ?? 'null',
      excerpt: (content.evidence ?? q.passage?.body?.slice(0, 1200) ?? ''),
    };
  }

  /** Trả { kind: 'json', explanation } khi cache hit; { kind: 'stream', events } khi cần sinh mới */
  async explain(req: ExplainRequest): Promise<{ kind: 'json'; explanation: Explanation } | { kind: 'stream'; events: AsyncGenerator<AiStreamEvent> }> {
    const q = await this.loadQuestion(req.questionVersionId);
    if (!ExplainService.explainable(q)) throw new ValidationFailed({ issues: [{ path: 'question_version_id', message: 'explain_mcq does not support this question type' }] });
    const locale = await this.localeOf(req.userId);
    const rawChosen = req.chosenOption?.trim() || null;
    const answer = req.answer && req.answer.type === q.content.type ? req.answer : null;
    const chosen = explainChoiceKey(q.content.type, rawChosen, answer);
    const program = q.program_code;

    // Exam Mode chặn trước mọi thứ, kể cả cache hit (CLAUDE.md §5.8)
    await this.guard.assertNotInExam(req.userId);

    const task = await this.gateway.resolveTask('explain_mcq', program, req.userId);
    const started = Date.now();
    const hit = await this.cache.get(q.question_version_id, chosen, locale, task.promptVersionId);
    if (hit) {
      const aiTaskId = await this.gateway.recordCacheHit({ taskCode: 'explain_mcq', userId: req.userId, promptVersionId: hit.promptVersionId, inputRef: { question_version_id: q.question_version_id, chosen_option: chosen, locale, attempt_id: req.attemptId ?? null }, traceId: req.traceId ?? null, latencyMs: Date.now() - started });
      return { kind: 'json', explanation: this.toExplanation(hit.content, locale, true, aiTaskId, hit.promptVersionId) };
    }

    // Gating S7 (FEATURE_GATES.ai_explain): quyền → credit → quota ngày (cache hit ở trên không tính)
    await this.gate.check(req.userId, program, 'ai_explain');
    const cost = task.route.creditsCost;
    const balance = await this.credits.balance(req.userId);
    if (balance < cost) throw new InsufficientCredits({ required: cost, balance });
    const ticket = await this.gate.consume(req.userId, program, 'ai_explain');

    const variables = ExplainService.variablesOf(q, rawChosen, locale, answer);
    const cache = this.cache;
    const toExplanation = this.toExplanation.bind(this);
    const writeShared = task.status === 'active';
    const stream = this.gateway.streamTask<ExplainMcqOutput>(
      { taskCode: 'explain_mcq', userId: req.userId, variables, locale, program, taskOverride: task, inputRef: { question_version_id: q.question_version_id, chosen_option: chosen, locale, attempt_id: req.attemptId ?? null }, traceId: req.traceId },
      async (tx, r) => {
        if (writeShared) await cache.put(tx, q.question_version_id, chosen, locale, r.data, r.promptVersionId);
      },
    );

    async function* mapped(): AsyncGenerator<AiStreamEvent> {
      // vé gating tự chống hoàn hai lần
      const refund = () => ticket.release();
      let succeeded = false;
      try {
        for await (const ev of stream) {
          if (ev.event === 'result') {
            succeeded = true;
            yield { event: 'result', data: toExplanation(ev.data as ExplainMcqOutput, locale, false, ev.ai_task_id, task.promptVersionId), ai_task_id: ev.ai_task_id, cached: false };
          } else {
            if (ev.event === 'error') await refund();
            yield ev;
          }
        }
      } catch (err) {
        await refund();
        yield { event: 'error', code: 'ai_failed', message: (err as Error).message };
        yield { event: 'done' };
      } finally {
        // Client ngắt kết nối trước khi có kết quả → không tính lượt
        if (!succeeded) await refund();
      }
    }
    return { kind: 'stream', events: mapped() };
  }

  /** Giải thích đã có trong cache (dùng ở Review) */
  async cached(questionVersionId: string, chosenOption: string | null, locale: string, userId: string | null = null, program: string = DEFAULT_PROGRAM): Promise<Explanation | null> {
    const pv = await this.gateway.currentPromptVersionId('explain_mcq', program, userId);
    if (!pv) return null;
    const hit = await this.cache.get(questionVersionId, chosenOption, locale, pv);
    return hit ? this.toExplanation(hit.content, locale, true, null, hit.promptVersionId) : null;
  }
}
