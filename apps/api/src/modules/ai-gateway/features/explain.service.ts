import { Injectable } from '@nestjs/common';
import type { AiStreamEvent, ExplainMcqOutput, Explanation, Locale } from '@allingo/schemas';
import { FEATURE_CODES } from '@allingo/schemas';
import { InsufficientCredits, NotFound, ValidationFailed } from '../../../shared/http/errors.js';
import { CatalogQueryService, type LoadedQuestion } from '../../catalog/index.js';
import { CreditService, EntitlementService, QuotaService } from '../../billing/index.js';
import { UsersService } from '../../iam/index.js';
import { AiGatewayService } from '../core/ai-gateway.service.js';
import { ExplanationCacheService } from '../core/explanation-cache.service.js';
import { GuardrailsService } from '../core/guardrails.service.js';

export interface ExplainRequest {
  userId: string;
  questionVersionId: string;
  chosenOption?: string | null;
  attemptId?: string | null;
  traceId?: string;
}

/**
 * Giải thích câu hỏi (explain_mcq): Exam Mode → 403; cache hit → JSON ngay (không trừ credit/quota); miss → kiểm tra quota/credit → stream.
 */
@Injectable()
export class ExplainService {
  constructor(
    private readonly gateway: AiGatewayService,
    private readonly cache: ExplanationCacheService,
    private readonly guard: GuardrailsService,
    private readonly catalog: CatalogQueryService,
    private readonly entitlements: EntitlementService,
    private readonly quotas: QuotaService,
    private readonly credits: CreditService,
    private readonly users: UsersService,
  ) {}

  private toExplanation(out: ExplainMcqOutput, locale: string, cached: boolean, aiTaskId: string | null): Explanation {
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

  /** Trả { kind: 'json', explanation } khi cache hit; { kind: 'stream', events } khi cần sinh mới */
  async explain(req: ExplainRequest): Promise<{ kind: 'json'; explanation: Explanation } | { kind: 'stream'; events: AsyncGenerator<AiStreamEvent> }> {
    const q = await this.loadQuestion(req.questionVersionId);
    if (!('options' in q.content)) throw new ValidationFailed({ issues: [{ path: 'question_version_id', message: 'explain_mcq only supports multiple-choice questions' }] });
    const locale = await this.localeOf(req.userId);
    const chosen = req.chosenOption?.trim() || null;

    // Exam Mode chặn trước mọi thứ, kể cả cache hit (CLAUDE.md §5.8)
    await this.guard.assertNotInExam(req.userId);

    const hit = await this.cache.get(q.question_version_id, chosen, locale);
    if (hit) return { kind: 'json', explanation: this.toExplanation(hit.content, locale, true, null) };

    const ctx = await this.entitlements.require(req.userId, 'toeic', FEATURE_CODES.AI_EXPLAIN);
    const cost = await this.gateway.estimateCredits('explain_mcq', 'toeic');
    const balance = await this.credits.balance(req.userId);
    if (balance < cost) throw new InsufficientCredits({ required: cost, balance });
    await this.quotas.consume(req.userId, ctx.planKind, FEATURE_CODES.AI_EXPLAIN);

    const content = q.content;
    const correct = 'answer_key' in content && 'correct' in content.answer_key ? (content.answer_key as { correct: string | string[] }).correct : '';
    const variables = {
      program: 'toeic',
      section_code: q.section_code,
      question_type: q.question_type,
      learner_level: 'B1',
      explanation_seed: (content.explanation?.[locale] ?? content.explanation?.vi ?? content.explanation?.en ?? ''),
      related_codes: q.subskill_codes,
      stem: content.stem,
      options: content.options.map((o) => ({ key: o.key, text: o.text })),
      correct_option: Array.isArray(correct) ? correct.join(',') : correct,
      chosen_option: chosen ?? 'null',
      excerpt: (content.evidence ?? q.passage?.body?.slice(0, 1200) ?? ''),
    };

    const cache = this.cache;
    const quotas = this.quotas;
    const toExplanation = this.toExplanation.bind(this);
    const stream = this.gateway.streamTask<ExplainMcqOutput>(
      { taskCode: 'explain_mcq', userId: req.userId, variables, locale, program: 'toeic', inputRef: { question_version_id: q.question_version_id, chosen_option: chosen, attempt_id: req.attemptId ?? null }, traceId: req.traceId },
      async (tx, r) => {
        await cache.put(tx, q.question_version_id, chosen, locale, r.data, null);
      },
    );

    async function* mapped(): AsyncGenerator<AiStreamEvent> {
      try {
        for await (const ev of stream) {
          if (ev.event === 'result') yield { event: 'result', data: toExplanation(ev.data as ExplainMcqOutput, locale, false, ev.ai_task_id), ai_task_id: ev.ai_task_id, cached: false };
          else yield ev;
        }
      } catch (err) {
        await quotas.refund(req.userId, ctx.planKind, FEATURE_CODES.AI_EXPLAIN);
        yield { event: 'error', code: 'ai_failed', message: (err as Error).message };
        yield { event: 'done' };
      }
    }
    return { kind: 'stream', events: mapped() };
  }

  /** Giải thích đã có trong cache (dùng ở Review) */
  async cached(questionVersionId: string, chosenOption: string | null, locale: string): Promise<Explanation | null> {
    const hit = await this.cache.get(questionVersionId, chosenOption, locale);
    return hit ? this.toExplanation(hit.content, locale, true, null) : null;
  }
}
